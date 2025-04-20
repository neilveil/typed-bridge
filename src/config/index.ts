interface config {
  logs: {
    request: boolean
    response: boolean
    error: boolean
  }
  idPrefix: string
  responseDelay: number
  gracefulShutdown: boolean
}

export const config: config = {
  logs: {
    request: true,
    response: true,
    error: true
  },
  responseDelay: 0,
  gracefulShutdown: false,
  idPrefix: ''
}
