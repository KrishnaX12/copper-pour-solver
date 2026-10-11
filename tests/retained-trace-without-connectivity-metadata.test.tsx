import { expect, test } from "bun:test"
import { Circuit } from "@tscircuit/core"
import type { AnyCircuitElement, BRepShape } from "circuit-json"
import {
  CopperPourPipelineSolver,
  convertCircuitJsonToInputProblem,
} from "lib/index"
import { crossSectionFromPolygons } from "lib/solvers/copper-pour/manifold-geometry-adapter"
import { MANIFOLD_GEOMETRY_SCALE } from "lib/solvers/copper-pour/polygon-ring"
import { runSolverAndRenderToSvg } from "./utils/run-solver-and-render-to-svg"

const Endpoint = ({
  name,
  x,
  y,
  layer = "top",
  net,
}: {
  name: string
  x: number
  y: number
  layer?: "top" | "bottom"
  net: string
}) => (
  <testpoint
    name={name}
    pcbX={x}
    pcbY={y}
    layer={layer}
    connections={{ pin1: `net.${net}` }}
    footprint={
      <footprint>
        <smtpad shape="rect" portHints={["pin1"]} width={0.4} height={0.5} />
      </footprint>
    }
  />
)

const RetainedTraceRepro = ({ status = "Measuring physical copper" }) => (
  <board width={14} height={10}>
    <net name="GND" isGroundNet />
    <net name="SIGNAL_A" />
    <net name="SIGNAL_B" />
    <net name="BOTTOM_ONLY" />
    <Endpoint name="A1" x={-3} y={-1} net="SIGNAL_A" />
    <Endpoint name="A2" x={3} y={-1} net="SIGNAL_A" />
    <Endpoint name="B1" x={-3} y={1} net="SIGNAL_B" />
    <Endpoint name="B2" x={3} y={1} net="SIGNAL_B" />
    <Endpoint name="L1" x={-3} y={0} layer="bottom" net="BOTTOM_ONLY" />
    <Endpoint name="L2" x={3} y={0} layer="bottom" net="BOTTOM_ONLY" />
    <Endpoint name="G1" x={-3} y={-2.5} net="GND" />
    <Endpoint name="G2" x={3} y={-2.5} net="GND" />
    <trace
      from=".A1 > .pin1"
      to=".A2 > .pin1"
      thickness={0.3}
      pcbPath={[".A1 > .pin1", ".A2 > .pin1"]}
    />
    <trace
      from=".B1 > .pin1"
      to=".B2 > .pin1"
      thickness={0.6}
      pcbPath={[".B1 > .pin1", ".B2 > .pin1"]}
    />
    <trace
      from=".L1 > .pin1"
      to=".L2 > .pin1"
      thickness={0.5}
      pcbPath={[".L1 > .pin1", ".L2 > .pin1"]}
    />
    <trace
      from=".G1 > .pin1"
      to=".G2 > .pin1"
      thickness={0.3}
      pcbPath={[".G1 > .pin1", ".G2 > .pin1"]}
    />
    <copperpour
      layer="top"
      connectsTo="net.GND"
      traceMargin={0.2}
      padMargin={0.2}
    />
    <pcbnotetext
      text="Retained TOP copper must clear the GND pour"
      pcbY={4.3}
      fontSize={0.4}
      color="#ffffff"
    />
    <pcbnotetext text={status} pcbY={3.6} fontSize={0.32} color="#facc15" />
    <pcbnotetext
      text="SIGNAL_B: 0.60 mm TOP wire"
      pcbY={1.8}
      fontSize={0.3}
      color="#facc15"
    />
    <pcbnotetext
      text="SIGNAL_A: 0.30 mm TOP wire"
      pcbY={-1.65}
      fontSize={0.3}
      color="#facc15"
    />
    <pcbnotetext
      text="BOTTOM_ONLY: no TOP clearance required"
      pcbY={0.5}
      fontSize={0.27}
      color="#c4b5fd"
    />
    <pcbnotetext
      text="GND wire: same-net copper stays connected"
      pcbY={-3.2}
      fontSize={0.3}
      color="#34d399"
    />
    <pcbnotetext
      text="Expected: 0 overlap; 0.20 mm clearance around both TOP signals"
      pcbY={-4.2}
      fontSize={0.3}
      color="#ffffff"
    />
  </board>
)

const compileImportedTraces = async (status?: string) => {
  const circuit = new Circuit()
  circuit.pcbRoutingDisabled = true
  circuit.add(<RetainedTraceRepro status={status} />)
  await circuit.renderUntilSettled()
  expect(
    circuit.getCircuitJson().filter((e) => e.type.includes("error")),
  ).toEqual([])
  // Reproduce a cached native import with optional ownership/endpoint tags
  // absent. Every trace, pad, net, pour intent and note was compiled by Core;
  // the route coordinates, layers and widths remain untouched.
  return circuit.getCircuitJson().flatMap((element): AnyCircuitElement[] => {
    if (element.type === "pcb_copper_pour") return []
    if (
      element.type !== "pcb_trace" ||
      (element.route[0]?.route_type === "wire" && element.route[0].y === -2.5)
    )
      return [element as AnyCircuitElement]
    const { source_trace_id, ...retained } = element
    Reflect.deleteProperty(retained, "subcircuit_connectivity_map_key")
    return [
      {
        ...retained,
        route: retained.route.map((point) => {
          if (point.route_type !== "wire") return point
          const { start_pcb_port_id, end_pcb_port_id, ...wire } = point
          return wire
        }),
      } as AnyCircuitElement,
    ]
  })
}

// Intersect independently constructed straight-wire bodies with the actual
// solved BREP (holes included), measuring the downstream short in mm².
const overlapArea = (shapes: BRepShape[], y: number, width: number) => {
  const wire = crossSectionFromPolygons([
    [
      { x: -2.5, y: y - width / 2 },
      { x: 2.5, y: y - width / 2 },
      { x: 2.5, y: y + width / 2 },
      { x: -2.5, y: y + width / 2 },
    ],
  ])
  let area = 0
  try {
    for (const shape of shapes) {
      const pour = crossSectionFromPolygons(
        [
          shape.outer_ring.vertices,
          ...shape.inner_rings.map((ring) => ring.vertices),
        ],
        "EvenOdd",
      )
      const intersection = pour.intersect(wire)
      area += intersection.area() / MANIFOLD_GEOMETRY_SCALE ** 2
      intersection.delete()
      pour.delete()
    }
  } finally {
    wire.delete()
  }
  return area
}

test("retained copper without optional ownership metadata still clears a pour", async () => {
  const circuitJson = await compileImportedTraces()
  const traces = circuitJson.filter((element) => element.type === "pcb_trace")
  expect(traces).toHaveLength(4)
  const ground = circuitJson.find(
    (element) => element.type === "source_net" && element.name === "GND",
  )!
  if (ground.type !== "source_net") throw new Error("Missing compiled GND net")
  const options = {
    layer: "top" as const,
    source_net_id: ground.source_net_id,
    pad_margin: 0.2,
    trace_margin: 0.2,
  }
  const before = JSON.stringify(circuitJson)
  const input = convertCircuitJsonToInputProblem(circuitJson, options)
  const output = new CopperPourPipelineSolver(input).getOutput()
  const signalOverlap =
    overlapArea(output.brep_shapes, -1, 0.3) +
    overlapArea(output.brep_shapes, 1, 0.6)
  const clearanceOverlap =
    overlapArea(output.brep_shapes, -1, 0.7) +
    overlapArea(output.brep_shapes, 1, 1)
  const status =
    signalOverlap > 1e-6
      ? `FAIL: GND shorts both TOP signals (${signalOverlap.toFixed(2)} mm2 overlap)`
      : "FIXED: both TOP signals have 0.20 mm clearance; no short"
  const labeled = await compileImportedTraces(status)
  await expect(
    runSolverAndRenderToSvg(labeled, { ...options, net_name: "GND" }),
  ).toMatchSvgSnapshot(
    import.meta.path,
    "retained-trace-without-connectivity-metadata",
  )

  expect(signalOverlap).toBeLessThan(1e-6)
  expect(clearanceOverlap).toBeLessThan(1e-6)
  expect(overlapArea(output.brep_shapes, 0, 0.5)).toBeCloseTo(2.5)
  expect(overlapArea(output.brep_shapes, -2.5, 0.3)).toBeCloseTo(1.5)
  const retainedIds = new Set(
    traces
      .filter(
        (trace) =>
          trace.route[0]?.route_type === "wire" && trace.route[0].y !== -2.5,
      )
      .map((trace) => trace.pcb_trace_id),
  )
  const retained = input.pads.filter((pad) =>
    Array.from(retainedIds).some((id) => pad.padId.startsWith(`${id}-`)),
  )
  expect(retained).toHaveLength(2)
  expect(new Set(retained.map((pad) => pad.connectivityKey)).size).toBe(2)
  expect(
    retained.every(
      (pad) =>
        pad.layer === "top" &&
        pad.connectivityKey !== input.regionsForPour[0]!.connectivityKey,
    ),
  ).toBe(true)
  expect(JSON.stringify(circuitJson)).toBe(before)
})
