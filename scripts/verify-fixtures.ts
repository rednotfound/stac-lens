// Verification harness — no UI yet. Runs the Loader/Graph layer against
// two contrasting static fixtures (Atlas: messy/deep; spec example: minimal/flat)
// and prints out whether known edge cases from prior research are handled
// as designed. Run with: npx tsx scripts/verify-fixtures.ts

import { StacLoader } from '../src/stac/loader'
import { classifyNodeShape } from '../src/stac/types'
import { detectSourceKind, type RawStacObject } from '../src/stac/graph'
import { isOpenEnded } from '../src/stac/temporal'

const loader = new StacLoader()

function section(title: string) {
  console.log(`\n${'='.repeat(60)}\n${title}\n${'='.repeat(60)}`)
}

function describeLinks(hrefs: string[], label: string) {
  console.log(`  ${label} (${hrefs.length}):`)
  for (const href of hrefs.slice(0, 20)) console.log(`    - ${href}`)
  if (hrefs.length > 20) console.log(`    ... +${hrefs.length - 20} more`)
}

async function verifyAtlas() {
  section('ATLAS — https://digital-atlas.s3.amazonaws.com/stac/public_stac/catalog.json')

  const root = await loader.load('https://digital-atlas.s3.amazonaws.com/stac/public_stac/catalog.json')
  console.log(
    `root: type=${root.type} sourceKind=${JSON.stringify(detectSourceKind(root.raw as RawStacObject, root.href))}`,
  )
  describeLinks(root.childHrefs, 'children')

  const hazardHref = root.childHrefs.find((h) => /hazard/i.test(h))
  if (!hazardHref) {
    console.log('  !! could not find hazard_catalog child — aborting Atlas checks')
    return
  }
  const hazardCatalog = await loader.load(hazardHref)
  console.log(`\nhazard_catalog: type=${hazardCatalog.type} shape=${classifyNodeShape(hazardCatalog)}`)
  describeLinks(hazardCatalog.childHrefs, 'hazard sub-collections')

  const flatHref = hazardCatalog.childHrefs.find((h) => /hazard_timeseries_mean_annual/i.test(h))
  const branchHref = hazardCatalog.childHrefs.find((h) => /hazard_class_annual/i.test(h))

  if (flatHref) {
    const flat = await loader.load(flatHref)
    console.log(
      `\n[flat collection] hazard_timeseries_mean_annual: shape=${classifyNodeShape(flat)} ` +
        `stated temporal=${JSON.stringify(flat.temporal)}`,
    )
    const items = await loader.loadItems(flat, 5)
    for (const item of items) {
      console.log(
        `  item ${item.id}\n` +
          `    temporal=${JSON.stringify(item.temporal)}\n` +
          `    spatial.geometryInvalid=${item.spatial?.geometryInvalid} bbox=${JSON.stringify(item.spatial?.bbox)}\n` +
          `    declaredExtensions=${JSON.stringify(item.declaredExtensions)}\n` +
          `    propertyNamespaces=${JSON.stringify(item.propertyNamespaces)} (expect 'atlas' present + unknown-classified)`,
      )
    }
    // Stated-vs-actual conflict check (sampled, not exhaustive)
    const itemEnds = items
      .map((i) => (i.temporal?.kind === 'interval' ? i.temporal.end : undefined))
      .filter((v): v is string => !!v)
    if (flat.temporal?.kind === 'interval' && itemEnds.length) {
      const maxItemEnd = itemEnds.sort().at(-1)
      console.log(
        `  >> stated collection end=${flat.temporal.end} vs sampled max item end=${maxItemEnd} ` +
          `${maxItemEnd && flat.temporal.end && maxItemEnd > flat.temporal.end ? '=> CONFLICT (matches prior research finding)' : ''}`,
      )
    }
  } else {
    console.log('  !! hazard_timeseries_mean_annual not found among children')
  }

  if (branchHref) {
    const branch = await loader.load(branchHref)
    console.log(
      `\n[branch-of-collections] hazard_class_annual: shape=${classifyNodeShape(branch)} ` +
        `(expect 'branch-collections' — zero direct items, children are sub-collections)`,
    )
    describeLinks(branch.childHrefs, 'per-variable sub-collections')
  } else {
    console.log('  !! hazard_class_annual not found among children')
  }
}

async function verifySpecExample() {
  section('SPEC EXAMPLE — stac-spec examples/catalog.json (floor case)')

  let root
  try {
    root = await loader.load('https://raw.githubusercontent.com/radiantearth/stac-spec/master/examples/catalog.json')
  } catch (err) {
    console.log(`  !! failed to load spec example root: ${(err as Error).message}`)
    return
  }

  console.log(
    `root: type=${root.type} temporal=${JSON.stringify(root.temporal)} (expect undefined — Catalogs have no extent)`,
  )
  describeLinks(root.childHrefs, 'children (collections)')
  describeLinks(root.items.kind === 'links' ? root.items.hrefs : [], 'direct items on Catalog')

  for (const childHref of root.childHrefs) {
    const child = await loader.load(childHref)
    const shape = classifyNodeShape(child)
    console.log(
      `\ncollection ${child.id}: shape=${shape} temporal=${JSON.stringify(child.temporal)} ` +
        `openEnded=${child.temporal ? isOpenEnded(child.temporal) : 'n/a'} ` +
        `schemaHints=${JSON.stringify(child.schemaHints ? Object.keys(child.schemaHints) : undefined)}`,
    )
    if (shape === 'leaf-empty') {
      console.log('  >> confirmed genuine empty leaf (no items, no children) — not a loading error state')
    }
  }

  if (root.items.kind === 'links' && root.items.hrefs.length) {
    for (const itemHref of root.items.hrefs) {
      const item = await loader.load(itemHref)
      console.log(
        `\ndirect-catalog-child item ${item.id}:\n` +
          `  parentHref=${item.parentHref} (expect === catalog href, no Collection ancestor)\n` +
          `  temporal=${JSON.stringify(item.temporal)}\n` +
          `  declaredExtensions=${JSON.stringify(item.declaredExtensions)}\n` +
          `  propertyNamespaces=${JSON.stringify(item.propertyNamespaces)} (expect both 'view' (known) and 'cs' (unknown) present)`,
      )
    }
  }

  // Orphan minimal Item — not reachable via link-walking, verified present in repo by prior research.
  try {
    const simple = await loader.load(
      'https://raw.githubusercontent.com/radiantearth/stac-spec/master/examples/simple-item.json',
    )
    console.log(
      `\n[orphan floor item] simple-item: temporal=${JSON.stringify(simple.temporal)} ` +
        `declaredExtensions=${JSON.stringify(simple.declaredExtensions)} ` +
        `propertyNamespaces=${JSON.stringify(simple.propertyNamespaces)} (expect [] — zero custom properties)`,
    )
  } catch (err) {
    console.log(`\n  (simple-item.json not fetched: ${(err as Error).message})`)
  }
}

async function main() {
  await verifyAtlas()
  await verifySpecExample()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
