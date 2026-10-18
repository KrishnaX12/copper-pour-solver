import { expect, test } from "bun:test"
import { checkCopperToBoardEdgeClearance } from "@tscircuit/checks"
import { Circuit } from "@tscircuit/core"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { runSolverAndRenderToSvg } from "./utils/run-solver-and-render-to-svg"

test("explicit pour clears both rounded board corners", async () => {
  const boardEdgeMargin = 0.3
  const boardSize = 10
  const halfBoardSize = boardSize / 2
  const cornerRadius = 1.5
  const cornerCenter = halfBoardSize - cornerRadius
  const circuit = new Circuit()
  circuit.add(
    <board
      width={boardSize}
      height={boardSize}
      borderRadius={cornerRadius}
      routingDisabled
    >
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
  let svg = ""
  for (const layer of ["top", "bottom"] as const) {
    svg = runSolverAndRenderToSvg(
      circuit.getCircuitJson(),
      {
        layer,
        net_name: "GND",
        pad_margin: 0.2,
        trace_margin: 0.2,
        board_edge_margin: boardEdgeMargin,
        outline: [
          { x: -halfBoardSize, y: 0 },
          { x: halfBoardSize, y: 0 },
          { x: halfBoardSize, y: halfBoardSize },
          { x: -halfBoardSize, y: halfBoardSize },
        ],
      },
      (solvedCircuitJson) => {
        const clearanceErrors =
          checkCopperToBoardEdgeClearance(solvedCircuitJson)
        expect(clearanceErrors).toHaveLength(0)
        const pours = solvedCircuitJson.filter(
          (element) => element.type === "pcb_copper_pour",
        )
        expect(pours).toHaveLength(1)
        const pour = pours[0]!
        if (pour.shape !== "brep")
          throw new Error("Expected boundary representation")
        const vertices = pour.brep_shape.outer_ring.vertices
        expect(Math.min(...vertices.map((vertex) => vertex.y))).toBeCloseTo(
          boardEdgeMargin,
        )
        expect(Math.min(...vertices.map((vertex) => vertex.x))).toBeCloseTo(
          -halfBoardSize + boardEdgeMargin,
          5,
        )
        expect(Math.max(...vertices.map((vertex) => vertex.x))).toBeCloseTo(
          halfBoardSize - boardEdgeMargin,
          5,
        )
        expect(Math.max(...vertices.map((vertex) => vertex.y))).toBeCloseTo(
          halfBoardSize - boardEdgeMargin,
          5,
        )
        for (const side of [-1, 1]) {
          const cornerVertices = vertices.filter(
            (vertex) =>
              vertex.x * side > cornerCenter && vertex.y > cornerCenter,
          )
          expect(cornerVertices.length).toBeGreaterThan(0)
          for (const vertex of cornerVertices) {
            expect(
              Math.hypot(
                vertex.x - side * cornerCenter,
                vertex.y - cornerCenter,
              ),
            ).toBeLessThanOrEqual(cornerRadius - boardEdgeMargin + 0.001)
          }
        }
        return convertCircuitJsonToPcbSvg(
          [...solvedCircuitJson, ...clearanceErrors],
          {
            layer,
            showErrorsInTextOverlay: true,
          },
        )
      },
    )
  }
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
