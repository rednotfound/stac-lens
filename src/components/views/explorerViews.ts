/** The explorer's views over one open catalog. All of them render the same
 *  loaded graph (`StructureProvider`) and the same selection; they differ
 *  in what question they answer. The tree is the entry and the only view
 *  with Item Set boxes; the others are lighter readings of the structure.
 *  Named after the chart, not the concept, so the label says what appears. */
export type ExplorerView = 'tree' | 'outline' | 'icicle' | 'radial'

export const EXPLORER_VIEWS: { id: ExplorerView; label: string; title: string }[] = [
  {
    id: 'tree',
    label: 'Tree',
    title: 'The catalog as a node-link tree with each Collection’s Items opened in place — the main view',
  },
  {
    id: 'outline',
    label: 'Outline',
    title: 'The same structure as an indented document: read what is in here and how it nests',
  },
  {
    id: 'icicle',
    label: 'Icicle',
    title: 'Space-filling layers: how wide and how deep the publisher’s hierarchy is, at a glance',
  },
  {
    id: 'radial',
    label: 'Radial',
    title: 'The same tree wrapped around a circle: breadth as a ring, depth as concentric rings',
  },
]
