/** Notes the user just created with New (they open in edit mode once). */
const ids = new Set<string>();
export const markJustCreated = (id: string) => ids.add(id);
/** True once for a note marked as just created. */
export const takeJustCreated = (id: string) => ids.delete(id);
