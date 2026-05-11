/**
 * agro-crypt: Agricultural Cryptographic Certificate Tool
 * 
 * Copyright (c) Ronan Le Meillat - SCTG Development 2008-2012
 * Licensed under the MIT License
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

#ifndef AGRO_CRYPT_H
#define AGRO_CRYPT_H

#include <stddef.h>

/**
 * Generate a new ECC certificate signed by a CA
 * 
 * This function creates a new Elliptic Curve Cryptography certificate using
 * the NIST P-192 curve (prime192v1). The certificate is then signed by a
 * Certificate Authority using RSA with SHA-256.
 * 
 * @param ca_cert_path Path to the CA certificate file in PEM format
 * @param ca_key_path Path to the CA private key file in PEM format
 * @param cert_der Output buffer for the certificate in DER format
 * @param cert_der_len Output: length of the DER certificate
 * @param key_der Output buffer for the private key in DER format
 * @param key_der_len Output: length of the DER private key
 * @param cert_hash Output: SHA-256 hash of the certificate (hex string)
 * @param common_name Optional Common Name (CN) to use for the generated certificate; pass NULL to use the default
 * @return 0 on success, -1 on error
 */
int agro_generate_signed_cert(
    const char *ca_cert_path,
    const char *ca_key_path,
    unsigned char **cert_der,
    size_t *cert_der_len,
    unsigned char **key_der,
    size_t *key_der_len,
    char *cert_hash,
    const char *common_name
);

/**
 * Encrypt binary data using AES-256-CBC with password-based key derivation
 * 
 * This function encrypts data using AES-256 in CBC mode. The encryption key
 * is derived from the password using SHA-256 hashing, compatible with
 * OpenSSL's "enc" command format (with salt).
 * 
 * @param plaintext Input data to encrypt
 * @param plaintext_len Length of input data
 * @param password Password for key derivation
 * @param ciphertext Output buffer for encrypted data (caller must free)
 * @param ciphertext_len Output: length of encrypted data
 * @return 0 on success, -1 on error
 */
int agro_encrypt_aes256(
    const unsigned char *plaintext,
    size_t plaintext_len,
    const char *password,
    unsigned char **ciphertext,
    size_t *ciphertext_len
);

/**
 * Decrypt AES-256-CBC encrypted data
 * 
 * This function decrypts data that was encrypted with agro_encrypt_aes256().
 * It uses the same password-based key derivation with SHA-256.
 * 
 * @param ciphertext Encrypted data
 * @param ciphertext_len Length of encrypted data
 * @param password Password for key derivation
 * @param plaintext Output buffer for decrypted data (caller must free)
 * @param plaintext_len Output: length of decrypted data
 * @return 0 on success, -1 on error
 */
int agro_decrypt_aes256(
    const unsigned char *ciphertext,
    size_t ciphertext_len,
    const char *password,
    unsigned char **plaintext,
    size_t *plaintext_len
);

/**
 * Encode binary data to Base64 string
 * 
 * Base64 encoding converts binary data into ASCII text using 64 printable
 * characters, making it safe for text-based transmission.
 * 
 * @param input Binary data to encode
 * @param input_len Length of input data
 * @param output Output buffer for Base64 string (caller must free)
 * @return 0 on success, -1 on error
 */
int agro_base64_encode(
    const unsigned char *input,
    size_t input_len,
    char **output
);

/**
 * Decode Base64 string to binary data
 * 
 * This function converts Base64-encoded text back into binary data.
 * 
 * @param input Base64 string to decode
 * @param output Output buffer for binary data (caller must free)
 * @param output_len Output: length of decoded data
 * @return 0 on success, -1 on error
 */
int agro_base64_decode(
    const char *input,
    unsigned char **output,
    size_t *output_len
);

/**
 * Save data to a PEM file
 * 
 * PEM (Privacy-Enhanced Mail) is a text format for storing cryptographic
 * objects. This function wraps binary data in PEM headers/footers.
 * 
 * @param filename Output file path
 * @param label PEM label (e.g., "CERTIFICATE", "PRIVATE KEY")
 * @param data Binary data to save
 * @param data_len Length of data
 * @return 0 on success, -1 on error
 */
int agro_save_pem(
    const char *filename,
    const char *label,
    const unsigned char *data,
    size_t data_len
);

/**
 * Generate a QR code from text and save as SVG
 * 
 * This function creates a QR code Version 10 with error correction level H
 * (high - 30% damage resistance) and exports it as a Scalable Vector Graphics
 * file.
 * 
 * @param text Input text to encode
 * @param output_path Path for output SVG file
 * @return 0 on success, -1 on error
 */
int agro_generate_qr_svg(
    const char *text,
    const char *output_path
);

/**
 * Generate a QR code as PNG image file
 * 
 * This function encodes the input text as a QR code and saves it as
 * a PNG image file using libpng.
 * 
 * @param text Text to encode in QR code
 * @param output_path Path for output PNG file
 * @return 0 on success, -1 on error
 */
int agro_generate_qr_png(
    const char *text,
    const char *output_path
);

/**
 * Decode a QR code from a JPEG image
 * 
 * This function loads a JPEG image, searches for QR codes using the ZBar
 * library, and returns the decoded text.
 * 
 * @param jpeg_path Path to input JPEG file
 * @param decoded_text Output: decoded text (caller must free)
 * @return 0 on success, -1 on error
 */
int agro_decode_qr_jpeg(
    const char *jpeg_path,
    char **decoded_text
);

/**
 * Decode a QR code from a PNG image
 * 
 * This function loads a PNG image and decodes QR codes using the ZBar
 * library. PNG is preferred over JPEG for QR decoding to avoid compression artifacts.
 * 
 * @param png_path Path to input PNG file
 * @param decoded_text Output: decoded text (caller must free)
 * @return 0 on success, -1 on error
 */
int agro_decode_qr_png(
    const char *png_path,
    char **decoded_text
);

/**
 * Calculate SHA-256 hash of data and return as hex string
 * 
 * SHA-256 produces a 256-bit (32-byte) cryptographic hash, commonly
 * displayed as a 64-character hexadecimal string.
 * 
 * @param data Input data
 * @param data_len Length of input data
 * @param hex_output Output buffer for hex string (must be 65 bytes)
 * @return 0 on success, -1 on error
 */
int agro_sha256_hex(
    const unsigned char *data,
    size_t data_len,
    char *hex_output
);

/**
 * Compress binary data using zlib DEFLATE algorithm
 * 
 * This function compresses data using the zlib library, reducing size
 * for more efficient storage and transmission. Compression reduces QR code
 * complexity, enabling older scanners (zbar 0.3) to detect the codes.
 * 
 * @param plaintext Input data to compress
 * @param plaintext_len Length of input data
 * @param compressed Output buffer for compressed data (caller must free)
 * @param compressed_len Output: length of compressed data
 * @return 0 on success, -1 on error
 */
int agro_compress(
    const unsigned char *plaintext,
    size_t plaintext_len,
    unsigned char **compressed,
    size_t *compressed_len
);

/**
 * Decompress data compressed with agro_compress()
 * 
 * This function decompresses zlib-compressed data back to original form.
 * 
 * @param compressed Compressed data
 * @param compressed_len Length of compressed data
 * @param decompressed Output buffer for decompressed data (caller must free)
 * @param decompressed_len Output: length of decompressed data
 * @return 0 on success, -1 on error
 */
int agro_decompress(
    const unsigned char *compressed,
    size_t compressed_len,
    unsigned char **decompressed,
    size_t *decompressed_len
);

#endif /* AGRO_CRYPT_H */

