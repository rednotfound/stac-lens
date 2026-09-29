/** The explorer's views over one open catalog. All of them render the same
 *  loaded graph (`StructureProvider`) and the same selection; they differ
 *  in what question they answer. The tree is the entry and comes first;
 *  the others are lighter readings of the same structure. Every view is
 *  named after its chart so the label says what appears — the tree was
 *  briefly "Explore" while it alone had the Item Set; with the Items
 *  window and the structure actions shared by every view, it is a tree
 *  among views again. */
export type ExplorerView = 'tree' | 'outline' | 'icicle'

export const EXPLORER_VIEWS: { id: ExplorerView; label: string; title: string }[] = [
  {
    id: 'tree',
    label: 'Tree',
    title: 'The main view: the catalog as a node-link tree — the structure as the publisher made it',
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
]
