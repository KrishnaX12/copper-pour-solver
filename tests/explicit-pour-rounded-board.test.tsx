import { expect, test } from "bun:test"
import { Circuit } from "@tscircuit/core"
import { checkCopperToBoardEdgeClearance } from "@tscircuit/checks"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { runSolverAndRenderToSvg } from "./utils/run-solver-and-render-to-svg"

test("explicit pour ignores rounded board corners", async () => {
  const circuit = new Circuit()
  circuit.add(
    <board width={10} height={10} borderRadius={1.5} routingDisabled>
      <net name="GND" />
      <pcbnotetext
        text="Explicit GND pour: 0.3 mm board-edge margin"
        pcbY={-1.5}
        fontSize={0.32}
      />
      <pcbnotetext
        text="LEFT: follow rounded edge"
        pcbX={-2.5}
        pcbY={-2.5}
        fontSize={0.22}
      />
      <pcbnotetext
        text="RIGHT: follow rounded edge"
        pcbX={2.5}
        pcbY={-2.5}
        fontSize={0.22}
      />
      <pcbnotetext
        text="Expected: both corners clear by 0.3 mm"
        pcbY={-3.5}
        fontSize={0.28}
      />
    </board>,
  )
  await circuit.renderUntilSettled()
  let clearanceErrors: ReturnType<typeof checkCopperToBoardEdgeClearance> = []
  const svg = runSolverAndRenderToSvg(
    circuit.getCircuitJson(),
    {
      layer: "bottom",
      net_name: "GND",
      pad_margin: 0.2,
      trace_margin: 0.2,
      board_edge_margin: 0.3,
      outline: [
        { x: -5, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 5 },
        { x: -5, y: 5 },
      ],
    },
    (solvedCircuitJson) => {
      clearanceErrors = checkCopperToBoardEdgeClearance(solvedCircuitJson)
      return convertCircuitJsonToPcbSvg(
        [...solvedCircuitJson, ...clearanceErrors],
        {
          layer: "bottom",
          showErrorsInTextOverlay: true,
        },
      )
    },
  )
  expect(clearanceErrors).toHaveLength(1)
  expect(clearanceErrors[0]!.message).toContain(
    "violates copper-to-board-edge clearance (measured 0.000mm, required 0.200mm)",
  )
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
