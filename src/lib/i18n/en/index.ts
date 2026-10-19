import { common } from "./common";
import { layout } from "./layout";
import { projects } from "./projects";
import { tickets } from "./tickets";
import { setup } from "./setup";
import { misc } from "./misc";

/** The source of truth for interface copy: the Spanish dictionary mirrors this shape. */
export const en = { common, layout, projects, tickets, setup, misc };

export type Dictionary = typeof en;
