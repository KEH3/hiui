const Path = require('path')
const Fs = require('fs')
const rollup = require('rollup')
const { babel, getBabelOutputPlugin } = require('@rollup/plugin-babel')
const { nodeResolve } = require('@rollup/plugin-node-resolve')
const commonjs = require('@rollup/plugin-commonjs')
const typescript = require('@rollup/plugin-typescript')
const postcss = require('rollup-plugin-postcss')
const image = require('@rollup/plugin-image')
const { terser } = require('rollup-plugin-terser')
const simpleVars = require('postcss-simple-vars')
const postcssImport = require('postcss-import')
const cssNested = require('postcss-nested')
const postcssPresetEnv = require('postcss-preset-env')
const postcssFlexBugfix = require('postcss-flexbugs-fixes')
const cssnano = require('cssnano')
const autoprefixer = require('autoprefixer')
const json = require('@rollup/plugin-json')
const { visualizer } = require('rollup-plugin-visualizer')
// const injectCSSImport =  require('./plugins/inject-css-import')
const cleanSCSS  = require('./plugins/clean-scss')

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx']

const requireModule = (p) => Fs.existsSync(p) && require(p)

const resolvePackage = (cwd) => {
  const pkg = requireModule(Path.join(cwd, 'package.json'))
  return pkg || {}
}

const getBanner = (pkg) => {
  return `/** @LICENSE
 * ${pkg.name}
 * ${pkg.homepage}
 *
 * Copyright (c) ${pkg.author}.
 *
 * This source code is licensed under the ${pkg.license} license found in the
 * LICENSE file in the root directory of this source tree.
 */`
}

// https://github.com/rollup/plugins/tree/master/packages/babel#babelhelpers
const getExternals = (pkg) => {
  /** @type {(string | RegExp)[]} */
  return [/tslib|@babel|style-inject|inject-head-style/]
    .concat(Object.keys(pkg.peerDependencies || {}))
    .concat(Object.keys(pkg.dependencies || {}))
}

const getBabelConfig = (type, target) => {
  const isESM = type === 'esm'

  // check support targets
  const isBrowser = target === 'browser'
  const envTarget = isBrowser ? { browsers: ['last 2 versions', 'IE 10'] } : { node: 11 }

  const presets = [
    [
      '@babel/preset-env',
      {
        loose: true,
        // rollup have to use EsModules to import
        modules: false,
        targets: envTarget,
      },
    ],
    '@babel/preset-typescript',
    '@babel/preset-react',
  ]

  const plugins = [
    [
      '@babel/plugin-transform-runtime',
      {
        useESModules: isESM ? true : undefined,
      },
    ],
  ]

  return {
    presets,
    plugins,
  }
}

const getRollupConfig = (input, outputPath, options, pkg) => {
  const external = getExternals(pkg)

  const {
    target = 'browser',
    format: formatOptions = 'cjs',
    sourceMaps = false,
    cssExtract = false,
    cssModules = false,
    preserved = true,
    compress = false,
    analysis = false,
  } = options

  const formats = formatOptions.split(',')

  const rollupConfigs = formats.map((type) => {
    const babelConfig = getBabelConfig(type, target)
    const isESM = type === 'esm'

    const inputOptions = {
      input,
      external,
      makeAbsoluteExternalsRelative: true,
	    preserveEntrySignatures: 'strict',
      treeshake: {
        propertyReadSideEffects: false,
      },
      plugins: [
        nodeResolve(),
        commonjs(),
        babel({
          extensions: EXTENSIONS,
          babelHelpers: 'runtime',
          exclude: /node_modules/,
          // Use custom babel configuration to convenient unified manner
          ...babelConfig,
          babelrc: false,
          configFile: false,
        }),
        typescript({
          typescript: require('typescript'),
          // https://github.com/rollup/plugins/issues/568
          declaration: false,
          // declarationDir: Path.join(outputPath, 'types'),
          sourceMap: sourceMaps,
        }),
        image(),
        postcss({
          plugins: [
            postcssFlexBugfix(),
            // using latest autoprefixer https://github.com/postcss/autoprefixer/issues/44
            autoprefixer({
              remove: false,
              flexbox: 'no-2009',
              grid: true,
            }),
            postcssPresetEnv({
              autoprefixer: false,
              stage: 4,
            }),
            postcssImport(),
            simpleVars(),
            cssNested(),
            compress && cssnano(),
          ],
          extensions: ['.scss', '.css'],
          // Extract styleInject as a external module
          inject: !cssExtract ? (variableName) => {
            if (isESM) {
              return `;import __styleInject__ from '@hi-ui/style-inject';__styleInject__(${variableName});`
            }
            return `;var __styleInject__=require('@hi-ui/style-inject').default;__styleInject__(${variableName});`
          } : false,
          extract: cssExtract,
          modules: cssModules,
        }),
        cleanSCSS(),
        // !cssExtract && injectCSSImport(),
        compress && terser(),
        json(),
        ...(analysis ? [visualizer()] : [])
      ].filter(Boolean),
    }

    const outputOptions = {
      // Adapt rollup type rule of output
      format: isESM ? 'es' : type,
      dir: outputPath,
      sourcemap: sourceMaps,
      banner() {
        return getBanner(pkg)
      },
      exports: 'named',
      globals: { react: 'React' },
      chunkFileNames: '[name].js',
      plugins: [
        getBabelOutputPlugin({
          presets: ['@babel/preset-env'],
          plugins: [
            [
              '@babel/plugin-transform-runtime',
              {
                useESModules: isESM ? true : undefined,
              },
            ],
          ],
        }),
      ],
      esModule: true,
      generatedCode: {
        reservedNamesAsProps: false
      },
      interop: 'compat',
      systemNullSetters: false
    }

    if (preserved) {
      outputOptions.preserveModules = true
      outputOptions.preserveModulesRoot = 'src'
    }

    return [inputOptions, outputOptions]
  })

  return rollupConfigs
}

async function build(rollupConfigs) {
  return Promise.all(
    rollupConfigs.map(async ([inputOptions, outputOptions]) => {
      // create bundler with rollup
      const bundle = await rollup.rollup(inputOptions)

      // write individual bundles
      await bundle.write(outputOptions)
    })
  )
}

function main(userOptions) {
  const options = Object.assign({}, userOptions)

  const cwd = process.cwd()

  const pkg = resolvePackage(cwd)

  const inputPath = Path.join(cwd, options.src)
  const outputPath = Path.join(cwd, options.dist)

  const configs = getRollupConfig(inputPath, outputPath, options, pkg)

  return build(configs)
}

module.exports = main
