import type { TicketPriority, TicketStatus } from "./ticket";

/** A ticket as a graph node. Edges are derived from the `links` frontmatter. */
export interface GraphNode {
  id: string;
  title: string;
  status: TicketStatus;
  priority: TicketPriority;
  tags: string[];
  filename: string;
}

/**
 * An undirected pair of ticket ids. The backend stores a link on the source
 * ticket only, but collapses `A → B` and `B → A` into a single edge.
 */
export interface GraphEdge {
  source: string;
  target: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
