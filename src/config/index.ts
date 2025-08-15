interface config {
    logs: {
        request: boolean
        response: boolean
        error: boolean
    }
    responseDelay: number
}

export const config: config = {
    logs: {
        request: true,
        response: true,
        error: true
    },
    responseDelay: 0
}
