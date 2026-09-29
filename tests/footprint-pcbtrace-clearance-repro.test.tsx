import { expect, test } from "bun:test"
import { Circuit } from "@tscircuit/core"
import type { PcbTraceRoutePoint, SourceNet } from "circuit-json"
import {
  CopperPourPipelineSolver,
  convertCircuitJsonToInputProblem,
} from "lib/index"
import { runSolverAndRenderToSvg } from "./utils/run-solver-and-render-to-svg"

test("source-less footprint pcbtrace is cleared from GND and VCC pours", async () => {
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
        text="GND POUR CLEARS PAD AND TRACE"
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
  const vccNet = circuitJson.find(
    (element): element is SourceNet =>
      element.type === "source_net" && element.name === "VCC",
  )

  expect(pad?.shape).toBe("rect")
  expect(trace?.source_trace_id).toBeUndefined()
  expect(trace?.pcb_component_id).toBe(pad?.pcb_component_id)
  if (pad?.shape !== "rect" || !trace || !gndNet || !vccNet) {
    throw new Error("Expected a rectangular pad, footprint trace, and nets")
  }

  const inputProblem = convertCircuitJsonToInputProblem(circuitJson, {
    layer: "top",
    source_net_id: gndNet.source_net_id,
    pad_margin: clearance,
    trace_margin: clearance,
    board_edge_margin: 0.2,
  })
  const padObstacle = inputProblem.pads.find(
    (obstacle) => obstacle.padId === pad.pcb_smtpad_id,
  )
  const traceObstacle = inputProblem.pads.find(
    (obstacle) => obstacle.shape === "trace",
  )
  const pourRegion = inputProblem.regionsForPour[0]
  expect(inputProblem.pads).toHaveLength(2)
  if (!padObstacle || traceObstacle?.shape !== "trace" || !pourRegion) {
    throw new Error("Expected pad, footprint trace, and pour region")
  }
  expect(padObstacle.connectivityKey).not.toBe(pourRegion.connectivityKey)
  expect(traceObstacle.connectivityKey).not.toBe(pourRegion.connectivityKey)

  const output = new CopperPourPipelineSolver(inputProblem).getOutput()
  expect(output.brep_shapes).toHaveLength(1)
  const clearanceRings = output.brep_shapes[0]!.inner_rings
  expect(clearanceRings).toHaveLength(1)
  const ringRight = Math.max(
    ...clearanceRings[0]!.vertices.map((point) => point.x),
  )
  const traceRight = Math.max(
    ...trace.route
      .filter((point) => point.route_type === "wire")
      .map((point) => point.x),
  )
  expect(ringRight).toBeCloseTo(
    traceRight + traceObstacle.width / 2 + clearance,
  )

  const vccInputProblem = convertCircuitJsonToInputProblem(circuitJson, {
    layer: "top",
    source_net_id: vccNet.source_net_id,
    pad_margin: clearance,
    trace_margin: clearance,
  })
  const vccPad = vccInputProblem.pads.find(
    (obstacle) => obstacle.padId === pad.pcb_smtpad_id,
  )
  const vccTrace = vccInputProblem.pads.find(
    (obstacle) => obstacle.shape === "trace",
  )
  const vccRegion = vccInputProblem.regionsForPour[0]
  if (!vccPad || !vccTrace || !vccRegion) {
    throw new Error("Expected pad, footprint trace, and VCC pour region")
  }
  expect(vccPad.connectivityKey).toBe(vccRegion.connectivityKey)
  expect(vccTrace.connectivityKey).not.toBe(vccRegion.connectivityKey)
  expect(
    new CopperPourPipelineSolver(vccInputProblem).getOutput().brep_shapes[0]
      ?.inner_rings,
  ).toHaveLength(1)

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
