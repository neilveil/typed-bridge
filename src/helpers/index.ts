import chalk from 'chalk'
import os from 'os'

const getLocalIPList = () => {
    const interfaces = os.networkInterfaces()
    const ipList: string[] = []

    Object.values(interfaces).forEach(ifaceArr => {
        ifaceArr?.forEach(iface => {
            if (iface.family === 'IPv4' && !iface.internal) {
                ipList.push(iface.address)
            }
        })
    })

    // Always include localhost for convenience
    if (!ipList.includes('127.0.0.1')) ipList.unshift('localhost')
    else ipList.unshift('localhost')

    return ipList
}

const seperator = '\n-x-x-x-x-x-\n'

export const printStartLogs = (port: number) => {
    const ipList = getLocalIPList()

    console.log(ipList)

    console.log(seperator)
    console.log(chalk.bgWhite.black('  Typed Bridge  '))
    console.log(seperator)
    console.log(chalk.green(`Server started at: ` + new Date().toISOString() + '\n'))
    ipList.map(ip => console.log(`Server running on: ` + chalk.blueBright(`${`http://${ip}:${port}`}`)))
    console.log(seperator)
}

export const printStopLogs = () => {
    console.log(seperator)
    console.log(chalk.red(`Server stopped at: ` + new Date().toISOString()))
    console.log(seperator)
}

export const matchesPattern = (str: string, pattern: string) => {
    // Escape regex special chars except "*"
    const escaped = pattern.replace(/[-\\^$+?.()|[\]{}]/g, '\\$&')
    // Replace "*" with ".*" for wildcard matching
    const regexStr = '^' + escaped.replace(/\*/g, '.*') + '$'
    return new RegExp(regexStr).test(str)
}
