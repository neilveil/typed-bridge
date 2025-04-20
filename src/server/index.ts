import { Application } from 'express'
import { Server } from 'http'
import { tbConfig } from '..'
import { printStartLogs, printStopLogs } from '../helpers'

export default (app: Application, port = 8080): Server => {
  const server = app.listen(port, () => printStartLogs(port))

  let shuttingDown = false
  const shutdown = () => {
    if (shuttingDown) return
    shuttingDown = true

    server.close()
    printStopLogs()

    if (!tbConfig.gracefulShutdown) process.exit(0)
  }

  process.on('SIGINT', () => shutdown())
  process.on('SIGTERM', () => shutdown())

  return server
}
