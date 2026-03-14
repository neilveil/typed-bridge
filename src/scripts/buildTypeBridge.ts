import { rollup } from 'rollup'
import dts from 'rollup-plugin-dts'

export default async function build(src = '', dest = '') {
  const bundle = await rollup({
    input: src,
    plugins: [dts({ respectExternal: false })],
    onwarn(warning, warn) {
      if (warning.code === 'UNRESOLVED_IMPORT') return
      warn(warning)
    }
  })

  await bundle.write({
    file: dest,
    format: 'es'
  })

}
