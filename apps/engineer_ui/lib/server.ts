import { cache } from "react";
import { loadCatalog } from "./catalog";

export const getCatalog = cache(() => loadCatalog());
