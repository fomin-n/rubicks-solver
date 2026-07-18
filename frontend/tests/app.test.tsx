import { render, screen } from "@testing-library/react";
import App from "../src/App";

it("renders the local-first welcome screen", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: /Scan your 2×2/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try demo without camera" })).toBeEnabled();
  expect(screen.getByText("No accounts. No cloud. No telemetry.")).toBeInTheDocument();
});

