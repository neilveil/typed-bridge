## Automatically sync bridge file from back-end to front-end

### Step 1: Host the bridge file

```ts
// Back-end

const app = createBridge(bridge, 8080, '/')

app.use(express.static(path.join(__dirname, 'public')))
```

### Step 2: Configure generate command to build in public directory

```json
{
    "scripts": {
        "gen-typed-bridge": "typed-bridge gen-typed-bridge --src ./src/bridge/index.ts --dest ./public/bridge.ts"
    }
}
```

### Step 3: Setup typed-bridge types file clone script

[Clone Kit](https://www.npmjs.com/package/clone-kit)

```bash
npm install clone-kit
```

Add clone-kit configuration file in front-end project `clone-kit.json`

```json
{
    "files": [
        {
            "name": "Typed Bridge",
            "src": "https://www.my-server.com/bridge.ts",
            "dst": "src/bridge.ts"
        }
    ]
}
```

### Step 4: Setup clone script to run before project start/build

```json
{
    "scripts": {
        "start": "next start && clone-kit ./clone-kit.json",
        "build": "next build && clone-kit ./clone-kit.json"
    }
}
```

> It's completely safe to share Typed Bridge types file publicly as it only contains request & response types.
