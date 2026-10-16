import { expect, test } from "bun:test"
import { Circuit } from "@tscircuit/core"
import {
  CopperPourPipelineSolver,
  convertCircuitJsonToInputProblem,
} from "lib/index"
import { runSolverAndRenderToSvg } from "./utils/run-solver-and-render-to-svg"

test("rotated rectangular cutout clearance follows the opening", async () => {
  const cutoutMargin = 0.3
  const ccwRotationDegrees = 45
  const cutoutWidth = 4
  const cutoutHeight = 2
  const cutoutCenter = { x: 0, y: 0 }
  const circuit = new Circuit()
  circuit.add(
    <board width={12} height={10} routingDisabled>
      <net name="GND" isGroundNet />
      <chip
        name="U1"
        pcbX={cutoutCenter.x}
        pcbY={cutoutCenter.y}
        pcbRotation={ccwRotationDegrees}
        footprint={
          <footprint>
            <cutout shape="rect" width={cutoutWidth} height={cutoutHeight} />
          </footprint>
        }
      />
      <pcbnotetext
        text="ROTATED RECTANGULAR CUTOUT"
        pcbY={3.5}
        fontSize={0.5}
      />
      <pcbnotetext
        text="Expected: clearance follows 45-degree opening"
        pcbY={-3.5}
        fontSize={0.4}
      />
    </board>,
  )
  await circuit.renderUntilSettled()

  const circuitJson = circuit.getCircuitJson()
  const cutout = circuitJson.find((element) => element.type === "pcb_cutout")
  if (cutout?.shape !== "rect")
    throw new Error("Expected the rectangular cutout rendered from TSX")
  expect(cutout.rotation).toBeCloseTo(ccwRotationDegrees, 4)
  const ccwRotationRadians = (ccwRotationDegrees * Math.PI) / 180
  const rotatedCutoutTop =
    cutoutCenter.y +
    (cutoutWidth * Math.sin(ccwRotationRadians) +
      cutoutHeight * Math.cos(ccwRotationRadians)) /
      2

  for (const layer of ["top", "bottom"] as const) {
    const input = convertCircuitJsonToInputProblem(circuitJson, {
      layer,
      source_net_name: "GND",
      pad_margin: 0.7,
      trace_margin: 0.7,
      cutout_margin: cutoutMargin,
    })
    expect(input.pads).toHaveLength(1)
    expect(input.pads[0]).toMatchObject({
      shape: "rotated_rect",
      padId: cutout.pcb_cutout_id,
      layer,
      x: cutoutCenter.x,
      y: cutoutCenter.y,
      width: cutoutWidth,
      height: cutoutHeight,
      ccwRotation: ccwRotationDegrees,
      connectivityKey: `cutout:${cutout.pcb_cutout_id}`,
    })
    const output = new CopperPourPipelineSolver(input).getOutput()
    expect(output.brep_shapes).toHaveLength(1)
    expect(output.brep_shapes[0]!.inner_rings).toHaveLength(1)
    const clearanceVertices = output.brep_shapes[0]!.inner_rings[0]!.vertices
    const clearanceTop = Math.max(...clearanceVertices.map((point) => point.y))
    expect(clearanceTop).toBeCloseTo(
      rotatedCutoutTop +
        cutoutMargin *
          (Math.sin(ccwRotationRadians) + Math.cos(ccwRotationRadians)),
      4,
    )
    expect(clearanceTop).toBeGreaterThan(rotatedCutoutTop)
  }

  await expect(
    runSolverAndRenderToSvg(circuitJson, {
      layer: "top",
      net_name: "GND",
      pad_margin: cutoutMargin,
      trace_margin: cutoutMargin,
      cutout_margin: cutoutMargin,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
