import type { SameShape } from "../shape";
import type { Dictionary } from "../en";
import { common } from "./common";
import { layout } from "./layout";
import { projects } from "./projects";
import { tickets } from "./tickets";
import { setup } from "./setup";
import { misc } from "./misc";

export const es: SameShape<Dictionary> = {
  common,
  layout,
  projects,
  tickets,
  setup,
  misc,
};
