import { expect, test } from "bun:test"
import { Circuit } from "@tscircuit/core"
import type { PCBKeepout } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import {
  CopperPourPipelineSolver,
  convertCircuitJsonToInputProblem,
} from "lib/index"
import { runSolverAndRenderToSvg } from "./utils/run-solver-and-render-to-svg"

test("repro: outline keepout is omitted from copper-pour obstacles", async () => {
  const strokeWidth = 1
  const outline = [
    { x: 2, y: 0 },
    { x: 6, y: 0 },
  ]
  const circuit = new Circuit()
  circuit.add(
    <board width={20} height={10} routingDisabled>
      <net name="GND" isGroundNet />
      <pcbnotetext text="GND POUR: OUTLINE KEEPOUT" pcbY={3.5} fontSize={0.6} />
      <pcbnotetext text="RECT CONTROL" pcbX={-4} pcbY={2} fontSize={0.5} />
      <pcbnotetext text="OUTLINE KEEPOUT" pcbX={4} pcbY={2} fontSize={0.5} />
      <pcbnotetext
        text="Expected: no copper inside the yellow guide"
        pcbY={-3}
        fontSize={0.5}
      />
      <pcbnotepath
        route={[
          { x: outline[0]!.x, y: -strokeWidth / 2 },
          { x: outline[1]!.x, y: -strokeWidth / 2 },
          { x: outline[1]!.x, y: strokeWidth / 2 },
          { x: outline[0]!.x, y: strokeWidth / 2 },
          { x: outline[0]!.x, y: -strokeWidth / 2 },
        ]}
        strokeWidth={0.05}
        color="#ffff00"
      />
    </board>,
  )
  await circuit.renderUntilSettled()
  const control: PCBKeepout = {
    type: "pcb_keepout",
    pcb_keepout_id: "pcb_keepout_control",
    shape: "rect",
    center: { x: -4, y: 0 },
    width: 4,
    height: strokeWidth,
    layers: ["top", "bottom"],
  }
  const keepout: PCBKeepout = {
    type: "pcb_keepout",
    pcb_keepout_id: "pcb_keepout_outline",
    shape: "outline",
    outline,
    stroke_width: strokeWidth,
    layers: ["top", "bottom"],
  }
  const circuitJson = [...circuit.getCircuitJson(), control, keepout]
  for (const layer of ["top", "bottom"] as const) {
    const input = convertCircuitJsonToInputProblem(circuitJson, {
      layer,
      source_net_name: "GND",
      pad_margin: 0.3,
      trace_margin: 0.3,
      board_edge_margin: 0.5,
    })
    expect(input.pads).toHaveLength(1)
    expect(input.pads[0]!.padId).toBe(control.pcb_keepout_id)
    const output = new CopperPourPipelineSolver(input).getOutput()
    expect(output.brep_shapes).toHaveLength(1)
    expect(output.brep_shapes[0]!.inner_rings).toHaveLength(1)
  }
  const svg = runSolverAndRenderToSvg(
    circuitJson,
    {
      layer: "top",
      net_name: "GND",
      pad_margin: 0.3,
      trace_margin: 0.3,
      board_edge_margin: 0.5,
    },
    (elements) =>
      convertCircuitJsonToPcbSvg(
        elements.filter((element) => element.type !== "pcb_keepout"),
      ),
  )
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
