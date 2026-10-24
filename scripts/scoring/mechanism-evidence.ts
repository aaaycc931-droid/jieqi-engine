import { captureMechanismEvents, type MechanismEvent } from "../../src/mechanism-observer.ts";

/** Research-only, sticky validity. Authority results always retain their meaning. */
export class MechanismEvidence {
  #valid = true;
  get valid(): boolean { return this.#valid; }

  capture<T>(operation: () => T, enabled = true): { result: T; events: readonly MechanismEvent[]; evidenceValid: boolean } {
    const captured: { result: T; events: readonly MechanismEvent[]; evidenceValid?: false } =
      enabled ? captureMechanismEvents(operation) : { result: operation(), events: [] };
    if (captured.evidenceValid === false) this.#valid = false;
    return { result: captured.result, events: this.#valid ? captured.events : [], evidenceValid: this.#valid };
  }

  requireValid(): void {
    if (!this.#valid) throw new Error("Invalid mechanism evidence: isolated observation failed");
  }
}
