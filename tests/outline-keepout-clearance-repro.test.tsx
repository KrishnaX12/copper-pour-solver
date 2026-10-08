import { expect, test } from "bun:test"
import { Circuit } from "@tscircuit/core"
import type { PCBKeepout, PcbBoard, Point } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import {
  CopperPourPipelineSolver,
  convertCircuitJsonToInputProblem,
} from "lib/index"
import { runSolverAndRenderToSvg } from "./utils/run-solver-and-render-to-svg"

test("outline keepout excludes copper on its layers", async () => {
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
        text="Expected: no copper inside the yellow boundary"
        pcbY={-3}
        fontSize={0.5}
      />
      <pcbnoterect
        pcbX={(outline[0]!.x + outline[1]!.x) / 2}
        pcbY={(outline[0]!.y + outline[1]!.y) / 2}
        width={outline[1]!.x - outline[0]!.x + strokeWidth}
        height={strokeWidth}
        cornerRadius={strokeWidth / 2}
        isFilled={false}
        hasStroke
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
    expect(input.pads).toHaveLength(2)
    expect(
      input.pads.find((pad) => pad.padId === keepout.pcb_keepout_id),
    ).toMatchObject({
      shape: "trace",
      layer,
      segments: outline,
      width: strokeWidth,
      connectivityKey: `keepout:${keepout.pcb_keepout_id}`,
    })
    const output = new CopperPourPipelineSolver(input).getOutput()
    expect(output.brep_shapes).toHaveLength(1)
    expect(output.brep_shapes[0]!.inner_rings).toHaveLength(2)
    const ring = output.brep_shapes[0]!.inner_rings.find((ring) =>
      ring.vertices.every(({ x }) => x > 0),
    )!
    const xs = ring.vertices.map(({ x }) => x)
    const ys = ring.vertices.map(({ y }) => y)
    expect(Math.min(...xs)).toBeCloseTo(outline[0]!.x - strokeWidth / 2, 4)
    expect(Math.max(...xs)).toBeCloseTo(outline[1]!.x + strokeWidth / 2, 4)
    expect(Math.min(...ys)).toBeCloseTo(-strokeWidth / 2, 4)
    expect(Math.max(...ys)).toBeCloseTo(strokeWidth / 2, 4)
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

test("all-layer keepouts exclude copper on every copper layer", () => {
  const board: PcbBoard = {
    type: "pcb_board",
    pcb_board_id: "pcb_board_0",
    center: { x: 0, y: 0 },
    width: 20,
    height: 10,
    num_layers: 4,
    thickness: 1.6,
    material: "fr4",
  }
  const keepouts: PCBKeepout[] = [
    {
      type: "pcb_keepout",
      pcb_keepout_id: "pcb_keepout_rect",
      shape: "rect",
      center: { x: -4, y: 0 },
      width: 2,
      height: 1,
      layers: ["all"],
    },
    {
      type: "pcb_keepout",
      pcb_keepout_id: "pcb_keepout_circle",
      shape: "circle",
      center: { x: 0, y: 0 },
      radius: 0.5,
      layers: ["all"],
    },
    {
      type: "pcb_keepout",
      pcb_keepout_id: "pcb_keepout_outline",
      shape: "outline",
      outline: [
        { x: 3, y: 0 },
        { x: 5, y: 0 },
      ],
      stroke_width: 1,
      layers: ["all"],
    },
  ]
  for (const layer of ["top", "inner1", "inner2", "bottom"] as const) {
    const input = convertCircuitJsonToInputProblem([board, ...keepouts], {
      layer,
      subcircuit_connectivity_map_key: "net_gnd",
      pad_margin: 0.3,
      trace_margin: 0.7,
    })
    expect(input.pads.map((pad) => pad.padId).sort()).toEqual(
      keepouts.map((keepout) => keepout.pcb_keepout_id).sort(),
    )
    expect(input.pads.every((pad) => pad.layer === layer)).toBe(true)
    const output = new CopperPourPipelineSolver(input).getOutput()
    expect(output.brep_shapes).toHaveLength(1)
    expect(output.brep_shapes[0]!.inner_rings).toHaveLength(keepouts.length)
  }
})

for (const { name, outline, copperRegions } of [
  {
    name: "vertical",
    outline: [
      { x: 0, y: -2 },
      { x: 0, y: 2 },
    ],
    copperRegions: 1,
  },
  {
    name: "diagonal",
    outline: [
      { x: -2, y: -2 },
      { x: 2, y: 2 },
    ],
    copperRegions: 1,
  },
  {
    name: "bent",
    outline: [
      { x: -2, y: -2 },
      { x: 2, y: -2 },
      { x: 2, y: 2 },
    ],
    copperRegions: 1,
  },
  {
    name: "closed",
    outline: [
      { x: -2, y: -2 },
      { x: 2, y: -2 },
      { x: 2, y: 2 },
      { x: -2, y: 2 },
      { x: -2, y: -2 },
    ],
    copperRegions: 2,
  },
] satisfies { name: string; outline: Point[]; copperRegions: number }[]) {
  test(`${name} outline keepout preserves stroke width and layer scope`, () => {
    const strokeWidth = 1
    const keepout: PCBKeepout = {
      type: "pcb_keepout",
      pcb_keepout_id: "pcb_keepout_outline",
      shape: "outline",
      outline,
      stroke_width: strokeWidth,
      layers: ["top"],
    }
    const circuitJson = [
      {
        type: "pcb_board" as const,
        pcb_board_id: "pcb_board_0",
        center: { x: 0, y: 0 },
        width: 12,
        height: 12,
        num_layers: 2,
        thickness: 1.6,
        material: "fr4" as const,
      },
      keepout,
    ]
    const options = {
      subcircuit_connectivity_map_key: "net_gnd",
      pad_margin: 0.3,
      trace_margin: 0.7,
    }
    const input = convertCircuitJsonToInputProblem(circuitJson, {
      ...options,
      layer: "top",
    })
    expect(input.pads).toHaveLength(1)
    const output = new CopperPourPipelineSolver(input).getOutput()
    expect(output.brep_shapes).toHaveLength(copperRegions)
    const ring = output.brep_shapes.flatMap((shape) => shape.inner_rings)[0]!
    const xs = ring.vertices.map(({ x }) => x)
    const ys = ring.vertices.map(({ y }) => y)
    expect(Math.min(...xs)).toBeCloseTo(
      Math.min(...outline.map(({ x }) => x)) - strokeWidth / 2,
      4,
    )
    expect(Math.max(...xs)).toBeCloseTo(
      Math.max(...outline.map(({ x }) => x)) + strokeWidth / 2,
      4,
    )
    expect(Math.min(...ys)).toBeCloseTo(
      Math.min(...outline.map(({ y }) => y)) - strokeWidth / 2,
      4,
    )
    expect(Math.max(...ys)).toBeCloseTo(
      Math.max(...outline.map(({ y }) => y)) + strokeWidth / 2,
      4,
    )
    expect(
      convertCircuitJsonToInputProblem(circuitJson, {
        ...options,
        layer: "bottom",
      }).pads,
    ).toHaveLength(0)
  })
}
