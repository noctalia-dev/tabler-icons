import outlineStroke from 'svg-outline-stroke'
import { asyncForEach, getAllIcons, getCompileOptions, getPackageDir, HOME_DIR } from '../../../.build/helpers.mjs'
import fs from 'fs'
import { resolve, basename } from 'path'
import crypto from 'crypto'
import { glob } from 'glob'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
import os from 'os'

const DIR = getPackageDir('icons-webfont')

// Parallel processing with concurrency limit
const CONCURRENCY = Math.max(1, os.cpus().length - 1)

const asyncPool = async (array, iteratorFn, concurrency = CONCURRENCY) => {
  const results = []
  const executing = new Set()

  for (const [index, item] of array.entries()) {
    const promise = Promise.resolve().then(() => iteratorFn(item, index))
    results.push(promise)
    executing.add(promise)

    const clean = () => executing.delete(promise)
    promise.then(clean, clean)

    if (executing.size >= concurrency) {
      await Promise.race(executing)
    }
  }

  return Promise.all(results)
}

const strokes = {
  // 200: 1,
  // 300: 1.5,
  400: 2,
}

const buildOutline = async () => {
  let filesList = {}
  const icons = getAllIcons(true)

  const compileOptions = getCompileOptions()

  for (const strokeName in strokes) {
    const stroke = strokes[strokeName]

    await asyncForEach(Object.entries(icons), async ([type, typeIcons]) => {
      fs.mkdirSync(resolve(DIR, `icons-outlined/${strokeName}/${type}`), { recursive: true })
      filesList[type] = []

      // Collect icons to process (synchronous filtering)
      const iconsToProcess = []
      for (const icon of typeIcons) {
        const { name, content, unicode } = icon
        if (compileOptions.includeIcons.length === 0 || compileOptions.includeIcons.indexOf(name) >= 0) {
          if (unicode) {
            const filename = `u${unicode.toUpperCase()}-${name}.svg`
            filesList[type].push(filename)
            iconsToProcess.push({ name, content, unicode, filename })
          }
        }
      }

      // Process icons in parallel using asyncPool
      console.log(`Processing ${iconsToProcess.length} ${type} icons with ${CONCURRENCY} parallel workers...`)
      let processed = 0

      await asyncPool(iconsToProcess, async ({ name, content, unicode, filename }) => {
        const cachedFilename = `u${unicode.toUpperCase()}-${name}.svg`;

        if (fs.existsSync(resolve(DIR, `icons-outlined/${strokeName}/${type}/${cachedFilename}`))) {
          let cachedContent = fs.readFileSync(resolve(DIR, `icons-outlined/${strokeName}/${type}/${cachedFilename}`), 'utf-8')
          let cachedHash = '';
          cachedContent = cachedContent.replace(/<!--\!cache:([a-z0-9]+)-->/, function (m, hash) {
            cachedHash = hash;
            return '';
          })
          if (crypto.createHash('sha1').update(cachedContent).digest("hex") === cachedHash) {
            processed++
            process.stdout.write(`\r${type}: ${processed}/${iconsToProcess.length} (cached: ${name})`.padEnd(80))
            return true;
          }
        }

        content = content
          .replace('width="24"', 'width="1000"')
          .replace('height="24"', 'height="1000"')
          .replace('stroke-width="2"', `stroke-width="${stroke}"`)

        try {
          const outlined = await outlineStroke(content, {
            optCurve: true,
            steps: 4,
            round: 0,
            centerHorizontally: true,
            fixedWidth: false,
            color: 'black'
          })

          fs.writeFileSync(resolve(DIR, `icons-outlined/${strokeName}/${type}/${filename}`), outlined, 'utf-8')
          await execAsync(`fontforge -lang=py -script .build/fix-outline.py icons-outlined/${strokeName}/${type}/${filename}`)
          await execAsync(`svgo icons-outlined/${strokeName}/${type}/${filename}`)

          const fixedFileContent = fs
            .readFileSync(resolve(DIR, `icons-outlined/${strokeName}/${type}/${filename}`), 'utf-8')
            .replace(/\n/g, ' ')
            .trim(),
            hashString = `<!--!cache:${crypto.createHash('sha1').update(fixedFileContent).digest("hex")}-->`

          fs.writeFileSync(
            resolve(DIR, `icons-outlined/${strokeName}/${type}/${filename}`),
            fixedFileContent + hashString,
            'utf-8'
          )

          processed++
          process.stdout.write(`\r${type}: ${processed}/${iconsToProcess.length} (built: ${name})`.padEnd(80))
        } catch (error) {
          console.error(`\nError processing ${name}:`, error.message)
        }
      })

      console.log(`\n${type}: Completed ${iconsToProcess.length} icons`)
    })

    // Remove old files
    await asyncForEach(Object.entries(icons), async ([type, icons]) => {
      const existedFiles = (await glob(resolve(DIR, `icons-outlined/${strokeName}/${type}/*.svg`))).map(file => basename(file))
      existedFiles.forEach(file => {
        if (filesList[type].indexOf(file) === -1) {
          console.log('Remove:', file)
          fs.unlinkSync(resolve(DIR, `icons-outlined/${strokeName}/${type}/${file}`))
        }
      })
    })

    // Copy icons from firs to all directory
    await asyncForEach(Object.entries(icons), async ([type, icons]) => {
      fs.mkdirSync(resolve(DIR, `icons-outlined/${strokeName}/all`), { recursive: true })

      await asyncForEach(icons, async function ({ name, unicode }) {
        const iconName = `u${unicode.toUpperCase()}-${name}`

        if (fs.existsSync(resolve(DIR, `icons-outlined/${strokeName}/${type}/${iconName}.svg`))) {
          // Copy file
          console.log(`Copy ${iconName} to all directory`)

          fs.copyFileSync(
            resolve(DIR, `icons-outlined/${strokeName}/${type}/${iconName}.svg`),
            resolve(DIR, `icons-outlined/${strokeName}/all/${iconName}${type !== 'outline' ? `-${type}` : ''}.svg`)
          )
        }
      })
    })
  }

  console.log('Done')
}

await buildOutline()
