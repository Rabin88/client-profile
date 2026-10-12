import type { ClientRecord } from "../types";

const clients: readonly ClientRecord[] = [
  { id: "C-001", firstName: "Amelia", lastName: "Hart", adviserId: "ADV-01" },
  { id: "C-002", firstName: "Oliver", lastName: "Shaw", adviserId: "ADV-01" },
  { id: "C-003", firstName: "Priya", lastName: "Nair", adviserId: "ADV-01" },
  { id: "C-004", firstName: "James", lastName: "Okafor", adviserId: "ADV-02" },
  // Client whose adviser has been revoked — adviser lookup will fail.
  { id: "A-000", firstName: "Grace", lastName: "Lowell", adviserId: "ADV-99" }
];

/** Mock of the Client-Data microservice. Returns a copy so callers can't mutate the store. */
export const ClientService = {
  async getDetails(clientId: string): Promise<ClientRecord | null> {
    const found = clients.find((c) => c.id === clientId);
    return found ? { ...found } : null;
  }
};
