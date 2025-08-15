import bridge, { typedBridgeConfig } from './bridge'

typedBridgeConfig.host = 'http://localhost:8080/bridge'
typedBridgeConfig.headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer 123'
}
typedBridgeConfig.onResponse = res => {
    // Custom response handling
}

const main = async () => {
    const user = await bridge['user.fetch']({ id: 1 })
    console.log(user)

    const users = await bridge['user.fetchAll']()
    console.log(users)

    const updatedUser = await bridge['user.update']({ id: 1, name: 'John Doe' })
    console.log(updatedUser)

    const usersAfterUpdate = await bridge['user.fetchAll']()
    console.log(usersAfterUpdate)

    try {
        await bridge['user.fetch']({ id: 5 })
    } catch (error) {
        console.log(error)
    }

    try {
        await bridge['user.fetch']({ id: 0 })
    } catch (error) {
        console.log(error)
    }
}

main()
