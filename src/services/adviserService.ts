import type { AdviserRecord } from "../types";

const advisers: readonly AdviserRecord[] = [
  { id: "ADV-01", name: "Sarah Whitfield", firm: "Northbank Wealth" },
  { id: "ADV-02", name: "Daniel Price", firm: "Kennet Financial Planning" }
];

const revoked = new Set<string>(["ADV-99"]);

/**
 * Simulates the raw failure a real HTTP client would throw: it carries
 * internal topology (host, port, status) that must never reach the UI.
 */
export class DownstreamServiceError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "DownstreamServiceError";
  }
}

/** Mock of the Adviser-Data microservice. */
export const AdviserService = {
  async getDetails(adviserId: string): Promise<AdviserRecord> {
    if (revoked.has(adviserId)) {
      throw new DownstreamServiceError(
        `GET http://adviser-svc.internal:8443/v1/advisers/${adviserId} -> 403 Forbidden: adviser licence revoked`,
        403
      );
    }
    // in real it will make a db call to get the advisor data
    const found = advisers.find((a) => a.id === adviserId);
    if (!found) {
      throw new DownstreamServiceError(
        `GET http://adviser-svc.internal:8443/v1/advisers/${adviserId} -> 404 Not Found`,
        404
      );
    }
    return { ...found };
  }
};
