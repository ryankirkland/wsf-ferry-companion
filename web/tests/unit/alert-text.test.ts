import { describe, expect, it } from "vitest";
import { alertBody } from "@/lib/trip/alert-text";

// Titles and texts below are verbatim WSF bulletins (the shapes captured in
// api-exploration-wsdot-ferries/samples/schedule_alerts.json plus the four on
// Sea/Brem the owner screenshotted 2026-08-30).
describe("alertBody - drop the body that only repeats the title", () => {
  it("drops an exact repeat", () => {
    expect(
      alertBody({
        title: "Sea/Brem -Update: ADA Alert - Kaleetan passenger elevator is available",
        text: "Sea/Brem -Update: ADA Alert - Kaleetan passenger elevator is available",
      }),
    ).toBeNull();
  });

  it("drops a repeat that drifted in spacing or punctuation", () => {
    expect(
      alertBody({
        title: "Edm/King - Boarding pass required daily, 8 a.m. to 8 p.m. through Oct.12",
        text: "Edm/King- Boarding pass required daily, 8 a.m. to 8 p.m. through Oct.12.",
      }),
    ).toBeNull();
  });

  it("drops a text the title already covers in full", () => {
    expect(
      alertBody({
        title: "Muk/Clin - ADA Alert - Suquamish #1 elevator is out of service",
        text: "ADA Alert - Suquamish #1 elevator is out of service",
      }),
    ).toBeNull();
  });

  it("drops empty and whitespace-only text", () => {
    expect(alertBody({ title: "WSF Community Meetings, Thursday, Sept. 10", text: null })).toBeNull();
    expect(alertBody({ title: "WSF Community Meetings, Thursday, Sept. 10", text: "   " })).toBeNull();
    expect(alertBody({ title: "Sea/Brem - ADA Alert", text: " - . " })).toBeNull();
  });

  it("KEEPS the same-day truth - cancellations live in this text", () => {
    const text =
      "FVS #2 - Missing crew. The 0405 VASH>FAU, 0425 FAU>SW and 0500 SW>VASH are cancelled. Updates to be provided.";
    expect(alertBody({ title: "FVS #2 CATHLAMET out of service start of 7/24", text })).toBe(text);
  });

  it("KEEPS text that extends the title - the extra clause may carry detail", () => {
    const text = "Edm/King - Vessel #1 running 25-30 minutes behind schedule. View the Real-Time Map.";
    expect(
      alertBody({ title: "Edm/King - Vessel #1 running 25-30 minutes behind schedule", text }),
    ).toBe(text);
  });

  it("never folds vessel or elevator numbers together", () => {
    const text = "Sea/Brem - ADA Alert - Chimacum #1 Elevator Out of Service";
    expect(
      alertBody({ title: "Sea/Brem - ADA Alert - Chimacum #2 Elevator Out of Service", text }),
    ).toBe(text);
  });

  it("returns a kept body trimmed, but otherwise untouched - no reformatting", () => {
    const text = "  Ana/SJs - the 1:30 sailing is cancelled.  ";
    expect(alertBody({ title: "Ana/SJs - vessel out of service", text })).toBe(text.trim());
  });
});
