import { $ } from 'bun'

async function build() {
  console.log('Building loop-runner...')
  
  // Install dependencies
  console.log('Installing dependencies...')
  await $`bun install`
  
  // Type check
  console.log('Type checking...')
  await $`bun run typecheck`
  
  // Build with Bun
  console.log('Building...')
  await $`bun build src/cli.ts --outdir dist --target node --format esm`
  
  // Copy package.json to dist
  console.log('Copying package.json...')
  const packageJson = await Bun.file('package.json').json()
  
  // Update package.json for dist
  delete packageJson.scripts
  delete packageJson.devDependencies
  
  await Bun.write('dist/package.json', JSON.stringify(packageJson, null, 2))
  
  console.log('Build complete!')
}

build().catch(console.error)
