import { expect, test } from "bun:test"
import { Circuit } from "@tscircuit/core"
import type { PcbTraceRoutePoint, SourceNet } from "circuit-json"
import {
  CopperPourPipelineSolver,
  convertCircuitJsonToInputProblem,
} from "lib/index"
import { runSolverAndRenderToSvg } from "./utils/run-solver-and-render-to-svg"

test("GND pour does not clear a footprint pcbtrace connected to a VCC pad", async () => {
  const clearance = 0.3
  const footprintTraceRoute = [
    { route_type: "wire", x: 0, y: 0, width: 0.4, layer: "top" },
    { route_type: "wire", x: 3, y: 0, width: 0.4, layer: "top" },
  ] satisfies PcbTraceRoutePoint[]
  const circuit = new Circuit()
  circuit.add(
    <board width="12mm" height="8mm" routingDisabled>
      <net name="GND" isGroundNet />
      <net name="VCC" isPowerNet />
      <chip
        name="J1"
        connections={{ pin1: "net.VCC" }}
        footprint={
          <footprint>
            <smtpad
              shape="rect"
              width="1mm"
              height="1mm"
              portHints={["pin1"]}
            />
            <pcbtrace route={footprintTraceRoute} />
          </footprint>
        }
      />
      <copperpour
        name="GND_TOP"
        layer="top"
        connectsTo="net.GND"
        padMargin={`${clearance}mm`}
        traceMargin={`${clearance}mm`}
      />
      <pcbnotetext
        text="VCC PAD + FOOTPRINT TRACE"
        pcbY={2}
        fontSize="0.4mm"
        anchorAlignment="center"
      />
      <pcbnotetext
        text="GND POUR CLEARS PAD, NOT TRACE"
        pcbY={-2}
        fontSize="0.4mm"
        anchorAlignment="center"
      />
    </board>,
  )
  await circuit.renderUntilSettled()

  const circuitJson = circuit.getCircuitJson()
  const pad = circuitJson.find((element) => element.type === "pcb_smtpad")
  const trace = circuitJson.find((element) => element.type === "pcb_trace")
  const gndNet = circuitJson.find(
    (element): element is SourceNet =>
      element.type === "source_net" && element.name === "GND",
  )

  expect(pad?.shape).toBe("rect")
  expect(trace?.source_trace_id).toBeUndefined()
  expect(trace?.pcb_component_id).toBe(pad?.pcb_component_id)
  if (pad?.shape !== "rect" || !trace || !gndNet) {
    throw new Error("Expected a rectangular pad, footprint trace, and GND net")
  }

  const inputProblem = convertCircuitJsonToInputProblem(circuitJson, {
    layer: "top",
    source_net_id: gndNet.source_net_id,
    pad_margin: clearance,
    trace_margin: clearance,
    board_edge_margin: 0.2,
  })
  expect(inputProblem.pads.map((obstacle) => obstacle.padId)).toEqual([
    pad.pcb_smtpad_id,
  ])
  expect(inputProblem.pads[0]!.connectivityKey).not.toBe(
    inputProblem.regionsForPour[0]!.connectivityKey,
  )

  const output = new CopperPourPipelineSolver(inputProblem).getOutput()
  expect(output.brep_shapes).toHaveLength(1)
  const clearanceRings = output.brep_shapes[0]!.inner_rings
  expect(clearanceRings).toHaveLength(1)
  const ringRight = Math.max(
    ...clearanceRings[0]!.vertices.map((point) => point.x),
  )
  expect(ringRight).toBeCloseTo(pad.x + pad.width / 2 + clearance)
  const traceRight = Math.max(
    ...trace.route
      .filter((point) => point.route_type === "wire")
      .map((point) => point.x),
  )
  expect(traceRight).toBeGreaterThan(ringRight)
  expect(traceRight).toBeLessThan(
    Math.max(
      ...output.brep_shapes[0]!.outer_ring.vertices.map((point) => point.x),
    ),
  )

  const svg = runSolverAndRenderToSvg(
    circuitJson.filter((element) => element.type !== "pcb_copper_pour"),
    {
      layer: "top",
      net_name: "GND",
      pad_margin: clearance,
      trace_margin: clearance,
      board_edge_margin: 0.2,
    },
  )
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
