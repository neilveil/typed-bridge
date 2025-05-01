import { Request, Response } from 'express'
import { config } from '../config'

export default (
    bridge: any,
    contextParser?: (req: Request, res: Response) => Promise<{ next?: boolean; context?: any } | void>
  ): any =>
  async (req: Request, res: Response) => {
    try {
      const path = req.path.split('/').pop() || ''
      const args = req.body

      if (!path) throw new Error('Bridge not found!')

      const serverFunction = bridge[path]
      if (!serverFunction) throw new Error('Bridge not found: ' + path)

      let context

      if (contextParser) {
        const contextParserRes = await contextParser(req, res)

        if (contextParserRes && contextParserRes.next === false) return

        context = contextParserRes?.context
      }

      res.json((await serverFunction(args, context)) || {})
    } catch (error: any) {
      if (Array.isArray(error.errors)) {
        const keyPath = error.errors[0].path.join('/')
        const errorMessage = (keyPath ? keyPath + ': ' : '') + error.errors[0].message
        return res.status(400).send(errorMessage)
      }

      if (config.logs.error) console.error(error)

      return res.status(500).json({ error: error.message })
    }
  }
