import { render, screen } from "@testing-library/react";
import App from "../src/App";

it("renders a clean welcome screen with only the available actions", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: /Scan your 2×2/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start scanning" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Try demo without camera" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Enter manually" })).toBeEnabled();
  expect(screen.queryByText("Local only")).not.toBeInTheDocument();
  expect(screen.queryByText(/Usable faces capture quickly/)).not.toBeInTheDocument();
  expect(screen.queryByText("No accounts. No cloud. No telemetry.")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "API health" })).not.toBeInTheDocument();
});
