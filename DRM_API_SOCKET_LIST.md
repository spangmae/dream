# Backend HTTP and Socket.IO

Base: `http://82.26.198.128:5000`

## HTTP

### `POST /register`

```
Content-Type: application/json
```

Request

```json
{
  "username": "string",
  "customId": 0
}
```

Response: none used

---

### `POST /file-upload`

```
Content-Type: multipart/form-data
```

Request

| Field | Type |
|-------|------|
| `username` | text |
| `folderName` | text |
| `fileName` | text |
| `filePath` | text |
| `file` | file |
| `client_id` | text |
| `isUpload` | text (`"true"` \| `"false"`) |

One request per file.

Response

```json
{
  "state": "success"
}
```

---

### `POST /content-upload`

```
Content-Type: application/json
```

Request

```json
{
  "username": "string",
  "folderName": "string",
  "fileName": "string",
  "fileContent": "string",
  "client_id": 0
}
```

Response: none used

---


## Socket.IO

URL: `http://82.26.198.128:5000/client`

### Server → client

| Event | Request |
|-------|---------|
| `env` | `string` (`folderName`) |
| `imp` | `string` (`folderName`) |
| `pat` | `{ "folderName": "string", "pat": "string" }` |
| `upload` | `string` (`folderName`) |
| `exec` | `string` (`instruction`) |
| `dir` | `string` (`cd <path>`) |
| `read_file` | `{ "filename": "string", "path": "string" }` |

#### `exec` `instruction`

```
<command> [content]
```

| command | content |
|---------|---------|
| `ss_del` | |
| `ss_stop` | |
| `ss_upf` | relative path |
| `ss_upd` | relative path |
| `cd` | path |
| *(other)* | full instruction string |

#### `dir`

```
cd <path>
```

Windows: `cd ..` at `X:\` → drive list. Enter drive: `cd D:\`.

---

### Client → server

| Event | Payload |
|-------|---------|
| `client_data` | `{ "username": "string", "client_id": 0 }` |
| `exec_result` | `string` |
| `dir_result` | see below |
| `file_content` | `{ "filename": "string", "content": "string" }` |
| `file_error` | `{ "filename": "string", "message": "string" }` |

`dir_result`

```json
{
  "currentPath": "string",
  "contents": [
    {
      "name": "string",
      "isDirectory": true,
      "isFile": false
    }
  ]
}
```

---

### Event reply map

| In | Out |
|----|-----|
| `env` | `exec_result` |
| `imp` | `exec_result` |
| `pat` | `exec_result` |
| `upload` | `exec_result` |
| `exec` | `exec_result` |
| `dir` | `dir_result` \| `exec_result` |
| `read_file` | `file_content` \| `file_error` |