interface config {
    logs: {
        request: boolean
        response: boolean
        error: boolean
        argsOnError: boolean
        contextOnError: boolean
    }
    responseDelay: number
}

export const config: config = {
    logs: {
        request: true,
        response: true,
        error: true,
        argsOnError: true,
        contextOnError: true
    },
    responseDelay: 0
}
