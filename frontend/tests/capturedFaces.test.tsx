import { fireEvent, render, screen, within } from "@testing-library/react";
import { CapturedFaces } from "../src/camera/CapturedFaces";
import type { CapturedFacePreview } from "../src/types";

function preview(face: "F" | "R" | "D", provisional = true, source: "scanned" | "inferred" = "scanned"): CapturedFacePreview {
  return {
    face,
    previewHex: ["#d72d3d", "#2468ce", "#24a665", "#dfc525"],
    predictedColors: ["red", "blue", "green", "yellow"],
    confidence: [0.8, 0.7, 0.6, 0.5],
    provisional,
    warnings: [],
    warningCodes: [],
    source,
  };
}

it("shows four immediate swatches per face and retakes only the selected face", () => {
  const onRetake = vi.fn();
  render(<CapturedFaces previews={{ F: preview("F"), R: preview("R", false) }} busy={false} onRetake={onRetake} />);
  const articles = screen.getAllByRole("article");
  expect(articles).toHaveLength(2);
  expect(within(articles[0]).getByLabelText("F recognized sticker preview").children).toHaveLength(4);
  expect((within(articles[0]).getByLabelText("F recognized sticker preview").children[0] as HTMLElement).style.getPropertyValue("--preview-color")).toBe("#e84255");
  expect(within(articles[1]).getByText("Final")).toBeInTheDocument();
  fireEvent.click(within(articles[0]).getByRole("button", { name: "Retake" }));
  expect(onRetake).toHaveBeenCalledWith("F");
  expect(articles[0]).toBeInTheDocument();
  expect(within(articles[1]).getByText("R")).toBeInTheDocument();
});

it("uses the fixed compact dock treatment while scanning", () => {
  render(<CapturedFaces compact previews={{ F: preview("F") }} busy={false} onRetake={vi.fn()} />);
  expect(screen.getByLabelText("Captured faces")).toHaveClass("compact");
  expect(screen.getAllByRole("article")).toHaveLength(5);
  expect(screen.getByLabelText("R not captured")).toBeInTheDocument();
  expect(screen.queryByLabelText("D not captured")).not.toBeInTheDocument();
  expect(screen.getByLabelText("F recognized sticker preview").children).toHaveLength(4);
  expect(screen.getByRole("button", { name: "Retake" })).toBeEnabled();
});

it("shows an inferred D in the complete canonical preview row without a retake action", () => {
  render(<CapturedFaces compact showInferred previews={{ F: preview("F"), D: preview("D", false, "inferred") }} busy={false} onRetake={vi.fn()} />);
  expect(screen.getAllByRole("article")).toHaveLength(6);
  const down = screen.getByText("D").closest("article");
  expect(down).not.toBeNull();
  expect(within(down!).getByText("Calculated")).toBeInTheDocument();
  const stickers = within(down!).getByLabelText("D recognized sticker preview").children;
  expect(stickers).toHaveLength(4);
  expect((stickers[0] as HTMLElement).style.getPropertyValue("--preview-color")).toBe("#e84255");
  expect(within(down!).queryByRole("button", { name: "Retake" })).not.toBeInTheDocument();
});
