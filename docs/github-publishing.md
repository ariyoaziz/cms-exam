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

Salin [.env.example](../.env.example) ke environment server dan isi dengan fine-grained GitHub token yang hanya memiliki akses ke satu repository. Berikan repository permission `Contents: read` untuk membaca SHA file existing dan `Contents: write` untuk membuat atau memperbarui file. Jika repository milik organisasi, token mungkin perlu persetujuan admin atau otorisasi SSO. Token tidak pernah dibaca client-side atau dikirim kembali melalui response.

Untuk Cloudflare Workers, set kelima variabel sebagai runtime variables/secrets pada Worker (`GITHUB_TOKEN` sebagai Secret). Jangan hanya mengaturnya sebagai Workers Builds build variables. Worker memakai `process.env`; konfigurasi Wrangler mengaktifkan `nodejs_compat` dan compatibility date yang mendukung populasi `process.env` dari runtime bindings.

Publisher hanya menerima repository, branch, dan path dari environment server. Client hanya mengirim website ID dan draft. Path harus berada di bawah `content/dapur-kita/`.

Publisher membaca file existing untuk memperoleh SHA, kemudian memakai GitHub Contents API PUT dengan commit message eksplisit. Jika file belum ada, PUT dilakukan tanpa SHA. Tidak ada force push atau operasi destruktif.

Jika GitHub menolak request, Cloudflare Worker logs mencatat status HTTP, pesan error GitHub yang disanitasi, endpoint tanpa credentials, `X-Accepted-GitHub-Permissions`, dan request ID saat tersedia. Response browser hanya menampilkan kategori aman karena route publish belum memiliki autentikasi. Header SSO hanya digunakan untuk menentukan kategori; URL otorisasi tidak dicatat atau diteruskan. Token, header Authorization, dan isi file repository tidak dicatat atau dikembalikan.

## Deployment status

Response sukses berarti commit GitHub dibuat dan mengembalikan commit SHA. Integrasi Cloudflare deployment belum tersedia dan tidak dilacak oleh CMS; UI sengaja menyatakan deployment sebagai belum dilacak.
