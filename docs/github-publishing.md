# GitHub publishing contract

Phase 7 mengaktifkan proof of concept hanya untuk website `site-dapur-kita`.

## Export

CMS menulis satu file versioned:

```text
content/dapur-kita/content.v1.json
```

Formatnya berisi `schemaVersion`, identitas website, `pages`, `sections`, `products`, dan `articles`. Draft buffer, localStorage, konfigurasi editor, media metadata, asset IDs internal, dan local upload URLs tidak diekspor. URL gambar harus berupa HTTPS URL produksi yang stabil.

Target website harus membaca JSON tersebut dari repository pada path yang sama dan memvalidasi `schemaVersion: 1` sebelum merender konten. Repository demo target belum tersedia dalam workspace ini; nilai `demo/dapur-kita` di registry tetap placeholder.

## Server configuration

Salin [.env.example](../.env.example) ke environment server dan isi dengan fine-grained GitHub token yang hanya memiliki Contents permission pada satu repository. Token tidak pernah dibaca client-side atau dikirim kembali melalui response.

Publisher hanya menerima repository, branch, dan path dari environment server. Client hanya mengirim website ID dan draft. Path harus berada di bawah `content/dapur-kita/`.

Publisher membaca file existing untuk memperoleh SHA, kemudian memakai GitHub Contents API PUT dengan commit message eksplisit. Jika file belum ada, PUT dilakukan tanpa SHA. Tidak ada force push atau operasi destruktif.

## Deployment status

Response sukses berarti commit GitHub dibuat dan mengembalikan commit SHA. Integrasi Cloudflare deployment belum tersedia dan tidak dilacak oleh CMS; UI sengaja menyatakan deployment sebagai belum dilacak.
