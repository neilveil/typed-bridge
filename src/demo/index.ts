import { createApp, createBridge, Request, Response, startServer, tbConfig } from '@/index'
import bridge from './bridge'

tbConfig.logs.error = true
tbConfig.logs.request = true
tbConfig.logs.response = true

const app = createApp()
startServer(app, 8080)

type context = {
  name: string
  authorization: string
}

const contextParser = async (req: Request, res: Response): Promise<{ next?: boolean; context?: context }> => {
  const headers = req.headers
  const bridge = req.originalUrl.split('/').pop()

  if (bridge === 'test.error') {
    res.sendStatus(400)
    return { next: false }
  }

  return {
    context: {
      name: 'Typed Bridge',
      authorization: headers.authorization || 'NO_AUTH'
    }
  }
}

app.use('/bridge', createBridge(bridge, contextParser))
