# DOCX rendering payloads

Each platform directory is populated by the release packaging job with the
matching LibreOffice and Poppler executables (and their runtime libraries and
fonts). The checked-in manifests define the required layout; build scripts
fail closed when a release payload is missing or contains the wrong target.

The Linux CLI archive intentionally carries both Linux architectures so one
download works on either `x64` or `arm64`. Desktop packages retain only their
target platform directory.
