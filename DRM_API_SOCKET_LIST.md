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