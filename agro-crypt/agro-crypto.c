/**
 * agro-crypt: Cryptographic Operations Module
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
 * 
 * This module handles all cryptographic operations including:
 * - ECC certificate generation and signing
 * - AES-256 encryption/decryption
 * - Base64 encoding/decoding
 * - SHA-256 hashing
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <openssl/ec.h>
#include <openssl/pem.h>
#include <openssl/x509.h>
#include <openssl/x509v3.h>
#include <openssl/evp.h>
#include <openssl/rand.h>
#include <openssl/sha.h>
#include <openssl/bio.h>
#include <openssl/buffer.h>
#include <openssl/err.h>
#include <zlib.h>
#include "agro-crypt.h"

/**
 * OpenSSL "Salted__" magic header for encrypted files
 * This matches the format used by "openssl enc" command
 */
#define OPENSSL_ENC_MAGIC "Salted__"
#define SALT_SIZE 8

/**
 * Initialize OpenSSL library (OpenSSL 1.0.0 API)
 * 
 * This function must be called before using any OpenSSL functions.
 * It loads algorithm implementations and error strings.
 */
static void init_openssl(void) {
    static int initialized = 0;
    if (!initialized) {
        OpenSSL_add_all_algorithms();
        ERR_load_crypto_strings();
        initialized = 1;
    }
}

/**
 * Generate a new ECC key pair using NIST P-192 curve
 * 
 * The P-192 curve (also known as prime192v1 or secp192r1) is a NIST
 * standard elliptic curve that provides approximately 96 bits of security.
 * 
 * @return EVP_PKEY pointer on success, NULL on error
 */
static EVP_PKEY *generate_ecc_key(void) {
    EVP_PKEY *pkey = NULL;
    EC_KEY *ec_key = NULL;
    
    /* Create an EC_KEY object for the prime192v1 curve */
    ec_key = EC_KEY_new_by_curve_name(NID_X9_62_prime192v1);
    if (ec_key == NULL) {
        fprintf(stderr, "Error: Failed to create EC_KEY\n");
        return NULL;
    }
    
    /* Generate the key pair */
    if (EC_KEY_generate_key(ec_key) != 1) {
        fprintf(stderr, "Error: Failed to generate EC key pair\n");
        EC_KEY_free(ec_key);
        return NULL;
    }
    
    /* Wrap the EC_KEY in an EVP_PKEY structure for general use */
    pkey = EVP_PKEY_new();
    if (pkey == NULL || EVP_PKEY_set1_EC_KEY(pkey, ec_key) != 1) {
        fprintf(stderr, "Error: Failed to wrap EC_KEY in EVP_PKEY\n");
        EC_KEY_free(ec_key);
        if (pkey) EVP_PKEY_free(pkey);
        return NULL;
    }
    
    EC_KEY_free(ec_key);
    return pkey;
}

/**
 * Create a self-signed X.509 certificate request
 * 
 * This creates a certificate with basic fields (serial number, validity period,
 * subject name). The certificate is then ready to be signed by a CA.
 * 
 * @param pkey Key pair to include in certificate
 * @return X509 certificate pointer on success, NULL on error
 */
static X509 *create_certificate(EVP_PKEY *pkey, const char *cn) {
    X509 *cert = NULL;
    X509_NAME *name = NULL;
    const char *use_cn = (cn && cn[0]) ? cn : "Agro-Crypt Certificate";
    
    cert = X509_new();
    if (cert == NULL) {
        fprintf(stderr, "Error: Failed to create X509 certificate\n");
        return NULL;
    }
    
    /* Set certificate version to V3 (value 2 = version 3) */
    X509_set_version(cert, 2);
    
    /* Generate a random serial number */
    unsigned char serial_bytes[8];
    RAND_bytes(serial_bytes, sizeof(serial_bytes));
    ASN1_INTEGER *serial = ASN1_INTEGER_new();
    ASN1_INTEGER_set(serial, *(long *)serial_bytes);
    X509_set_serialNumber(cert, serial);
    ASN1_INTEGER_free(serial);
    
    /* Set validity period: now to +365 days (OpenSSL 1.0.0 API) */
    X509_gmtime_adj(X509_get_notBefore(cert), 0);
    X509_gmtime_adj(X509_get_notAfter(cert), 365L * 24L * 3600L);
    
    /* Set the public key */
    X509_set_pubkey(cert, pkey);
    
    /* Set the subject name */
    name = X509_get_subject_name(cert);
    X509_NAME_add_entry_by_txt(name, "C", MBSTRING_ASC,
                               (unsigned char *)"FR", -1, -1, 0);
    X509_NAME_add_entry_by_txt(name, "O", MBSTRING_ASC,
                               (unsigned char *)"SCTG Development", -1, -1, 0);
    X509_NAME_add_entry_by_txt(name, "CN", MBSTRING_ASC,
                               (unsigned char *)use_cn, -1, -1, 0);
    
    /* For now, issuer = subject (will be replaced when signed by CA) */
    X509_set_issuer_name(cert, name);
    
    return cert;
}

/**
 * Sign a certificate with a CA using RSA-SHA256
 * 
 * This function takes an unsigned certificate and signs it using the CA's
 * private key. The signature algorithm is SHA-256 with RSA encryption.
 * 
 * @param cert Certificate to sign
 * @param ca_cert CA certificate (for issuer name)
 * @param ca_key CA private key
 * @return 0 on success, -1 on error
 */
static int sign_certificate(X509 *cert, X509 *ca_cert, EVP_PKEY *ca_key) {
    /* Set the issuer to the CA's subject name */
    X509_set_issuer_name(cert, X509_get_subject_name(ca_cert));
    
    /* Sign the certificate with SHA256 + RSA */
    if (X509_sign(cert, ca_key, EVP_sha256()) == 0) {
        fprintf(stderr, "Error: Failed to sign certificate\n");
        return -1;
    }
    
    return 0;
}

int agro_generate_signed_cert(
    const char *ca_cert_path,
    const char *ca_key_path,
    unsigned char **cert_der,
    size_t *cert_der_len,
    unsigned char **key_der,
    size_t *key_der_len,
    char *cert_hash,
    const char *common_name
) {
    init_openssl();
    
    EVP_PKEY *pkey = NULL;
    X509 *cert = NULL;
    X509 *ca_cert = NULL;
    EVP_PKEY *ca_key = NULL;
    FILE *fp = NULL;
    int ret = -1;
    
    /* Load CA certificate */
    fp = fopen(ca_cert_path, "r");
    if (fp == NULL) {
        fprintf(stderr, "Error: Cannot open CA certificate: %s\n", ca_cert_path);
        goto cleanup;
    }
    ca_cert = PEM_read_X509(fp, NULL, NULL, NULL);
    fclose(fp);
    if (ca_cert == NULL) {
        fprintf(stderr, "Error: Failed to read CA certificate\n");
        goto cleanup;
    }
    
    /* Load CA private key */
    fp = fopen(ca_key_path, "r");
    if (fp == NULL) {
        fprintf(stderr, "Error: Cannot open CA key: %s\n", ca_key_path);
        goto cleanup;
    }
    ca_key = PEM_read_PrivateKey(fp, NULL, NULL, NULL);
    fclose(fp);
    if (ca_key == NULL) {
        fprintf(stderr, "Error: Failed to read CA private key\n");
        goto cleanup;
    }
    
    /* Generate new ECC key pair */
    pkey = generate_ecc_key();
    if (pkey == NULL) {
        goto cleanup;
    }
    
    /* Create certificate */
    cert = create_certificate(pkey, common_name);
    if (cert == NULL) {
        goto cleanup;
    }
    
    /* Sign with CA */
    if (sign_certificate(cert, ca_cert, ca_key) != 0) {
        goto cleanup;
    }
    
    /* Convert certificate to DER format */
    int der_len = i2d_X509(cert, NULL);
    if (der_len < 0) {
        fprintf(stderr, "Error: Failed to get DER length\n");
        goto cleanup;
    }
    
    *cert_der = malloc(der_len);
    if (*cert_der == NULL) {
        fprintf(stderr, "Error: Memory allocation failed\n");
        goto cleanup;
    }
    
    unsigned char *der_ptr = *cert_der;
    if (i2d_X509(cert, &der_ptr) < 0) {
        fprintf(stderr, "Error: Failed to convert certificate to DER\n");
        free(*cert_der);
        *cert_der = NULL;
        goto cleanup;
    }
    *cert_der_len = der_len;
    
    /* Convert private key to DER format */
    der_len = i2d_PrivateKey(pkey, NULL);
    if (der_len < 0) {
        fprintf(stderr, "Error: Failed to get key DER length\n");
        goto cleanup;
    }
    
    *key_der = malloc(der_len);
    if (*key_der == NULL) {
        fprintf(stderr, "Error: Memory allocation failed\n");
        free(*cert_der);
        *cert_der = NULL;
        goto cleanup;
    }
    
    der_ptr = *key_der;
    if (i2d_PrivateKey(pkey, &der_ptr) < 0) {
        fprintf(stderr, "Error: Failed to convert key to DER\n");
        free(*cert_der);
        free(*key_der);
        *cert_der = NULL;
        *key_der = NULL;
        goto cleanup;
    }
    *key_der_len = der_len;
    
    /* Calculate SHA-256 hash of certificate */
    if (agro_sha256_hex(*cert_der, *cert_der_len, cert_hash) != 0) {
        free(*cert_der);
        free(*key_der);
        *cert_der = NULL;
        *key_der = NULL;
        goto cleanup;
    }
    
    ret = 0;
    
cleanup:
    if (pkey) EVP_PKEY_free(pkey);
    if (cert) X509_free(cert);
    if (ca_cert) X509_free(ca_cert);
    if (ca_key) EVP_PKEY_free(ca_key);
    
    return ret;
}

/**
 * Derive encryption key from password using SHA-256 (OpenSSL 1.0.0 API)
 * 
 * This mimics OpenSSL's EVP_BytesToKey behavior with MD=sha256.
 * The key and IV are derived from: hash(password + salt).
 * 
 * @param password Password string
 * @param salt Salt bytes (8 bytes)
 * @param key Output: derived key (32 bytes for AES-256)
 * @param iv Output: initialization vector (16 bytes for AES)
 */
static void derive_key_iv(const char *password, const unsigned char *salt,
                          unsigned char *key, unsigned char *iv) {
    EVP_MD_CTX *ctx = EVP_MD_CTX_create();  /* OpenSSL 1.0.0 API */
    unsigned char hash[SHA256_DIGEST_LENGTH];
    int key_len = 32;
    int iv_len = 16;
    
    /* First round: hash(password + salt) */
    EVP_DigestInit_ex(ctx, EVP_sha256(), NULL);
    EVP_DigestUpdate(ctx, password, strlen(password));
    EVP_DigestUpdate(ctx, salt, SALT_SIZE);
    EVP_DigestFinal_ex(ctx, hash, NULL);
    
    /* Copy key material */
    memcpy(key, hash, key_len);
    
    /* Second round for IV: hash(hash + password + salt) */
    EVP_DigestInit_ex(ctx, EVP_sha256(), NULL);
    EVP_DigestUpdate(ctx, hash, SHA256_DIGEST_LENGTH);
    EVP_DigestUpdate(ctx, password, strlen(password));
    EVP_DigestUpdate(ctx, salt, SALT_SIZE);
    EVP_DigestFinal_ex(ctx, hash, NULL);
    
    memcpy(iv, hash, iv_len);
    
    EVP_MD_CTX_destroy(ctx);  /* OpenSSL 1.0.0 API */
}

int agro_encrypt_aes256(
    const unsigned char *plaintext,
    size_t plaintext_len,
    const char *password,
    unsigned char **ciphertext,
    size_t *ciphertext_len
) {
    init_openssl();
    
    EVP_CIPHER_CTX *ctx = NULL;
    unsigned char salt[SALT_SIZE];
    unsigned char key[32];
    unsigned char iv[16];
    int len, final_len;
    int ret = -1;
    
    /* Generate random salt */
    if (RAND_bytes(salt, SALT_SIZE) != 1) {
        fprintf(stderr, "Error: Failed to generate random salt\n");
        return -1;
    }
    
    /* Derive key and IV from password */
    derive_key_iv(password, salt, key, iv);
    
    /* Allocate output buffer: magic + salt + encrypted_data + padding */
    /* OpenSSL 1.0.0 API: EVP_CIPHER_block_size() instead of EVP_CIPHER_get_block_size() */
    size_t max_len = strlen(OPENSSL_ENC_MAGIC) + SALT_SIZE + plaintext_len + 
                     EVP_CIPHER_block_size(EVP_aes_256_cbc());
    *ciphertext = malloc(max_len);
    if (*ciphertext == NULL) {
        fprintf(stderr, "Error: Memory allocation failed\n");
        return -1;
    }
    
    /* Write magic header and salt */
    memcpy(*ciphertext, OPENSSL_ENC_MAGIC, strlen(OPENSSL_ENC_MAGIC));
    memcpy(*ciphertext + strlen(OPENSSL_ENC_MAGIC), salt, SALT_SIZE);
    size_t header_len = strlen(OPENSSL_ENC_MAGIC) + SALT_SIZE;
    
    /* Initialize encryption context */
    ctx = EVP_CIPHER_CTX_new();
    if (ctx == NULL) {
        fprintf(stderr, "Error: Failed to create cipher context\n");
        free(*ciphertext);
        *ciphertext = NULL;
        return -1;
    }
    
    if (EVP_EncryptInit_ex(ctx, EVP_aes_256_cbc(), NULL, key, iv) != 1) {
        fprintf(stderr, "Error: Failed to initialize encryption\n");
        goto cleanup;
    }
    
    /* Encrypt data */
    if (EVP_EncryptUpdate(ctx, *ciphertext + header_len, &len, plaintext, plaintext_len) != 1) {
        fprintf(stderr, "Error: Encryption failed\n");
        goto cleanup;
    }
    
    /* Finalize encryption (adds padding) */
    if (EVP_EncryptFinal_ex(ctx, *ciphertext + header_len + len, &final_len) != 1) {
        fprintf(stderr, "Error: Encryption finalization failed\n");
        goto cleanup;
    }
    
    *ciphertext_len = header_len + len + final_len;
    ret = 0;
    
cleanup:
    if (ctx) EVP_CIPHER_CTX_free(ctx);
    if (ret != 0 && *ciphertext != NULL) {
        free(*ciphertext);
        *ciphertext = NULL;
    }
    
    return ret;
}

int agro_decrypt_aes256(
    const unsigned char *ciphertext,
    size_t ciphertext_len,
    const char *password,
    unsigned char **plaintext,
    size_t *plaintext_len
) {
    init_openssl();
    
    EVP_CIPHER_CTX *ctx = NULL;
    unsigned char key[32];
    unsigned char iv[16];
    int len, final_len;
    int ret = -1;
    size_t header_len = strlen(OPENSSL_ENC_MAGIC) + SALT_SIZE;
    
    /* Check minimum length */
    if (ciphertext_len < header_len) {
        fprintf(stderr, "Error: Ciphertext too short\n");
        return -1;
    }
    
    /* Verify magic header */
    if (memcmp(ciphertext, OPENSSL_ENC_MAGIC, strlen(OPENSSL_ENC_MAGIC)) != 0) {
        fprintf(stderr, "Error: Invalid ciphertext format\n");
        return -1;
    }
    
    /* Extract salt */
    const unsigned char *salt = ciphertext + strlen(OPENSSL_ENC_MAGIC);
    
    /* Derive key and IV */
    derive_key_iv(password, salt, key, iv);
    
    /* Allocate output buffer */
    *plaintext = malloc(ciphertext_len);
    if (*plaintext == NULL) {
        fprintf(stderr, "Error: Memory allocation failed\n");
        return -1;
    }
    
    /* Initialize decryption context */
    ctx = EVP_CIPHER_CTX_new();
    if (ctx == NULL) {
        fprintf(stderr, "Error: Failed to create cipher context\n");
        free(*plaintext);
        *plaintext = NULL;
        return -1;
    }
    
    if (EVP_DecryptInit_ex(ctx, EVP_aes_256_cbc(), NULL, key, iv) != 1) {
        fprintf(stderr, "Error: Failed to initialize decryption\n");
        goto cleanup;
    }
    
    /* Decrypt data */
    if (EVP_DecryptUpdate(ctx, *plaintext, &len, ciphertext + header_len, ciphertext_len - header_len) != 1) {
        fprintf(stderr, "Error: Decryption failed\n");
        goto cleanup;
    }
    
    /* Finalize decryption (removes padding) */
    if (EVP_DecryptFinal_ex(ctx, *plaintext + len, &final_len) != 1) {
        fprintf(stderr, "Error: Decryption finalization failed (wrong password?)\n");
        goto cleanup;
    }
    
    *plaintext_len = len + final_len;
    ret = 0;
    
cleanup:
    if (ctx) EVP_CIPHER_CTX_free(ctx);
    if (ret != 0 && *plaintext != NULL) {
        free(*plaintext);
        *plaintext = NULL;
    }
    
    return ret;
}

int agro_base64_encode(
    const unsigned char *input,
    size_t input_len,
    char **output
) {
    BIO *bio, *b64;
    BUF_MEM *buffer_ptr;
    
    /* Create Base64 encoding BIO chain */
    b64 = BIO_new(BIO_f_base64());
    bio = BIO_new(BIO_s_mem());
    bio = BIO_push(b64, bio);
    
    /* Don't use newlines */
    BIO_set_flags(bio, BIO_FLAGS_BASE64_NO_NL);
    
    /* Write data */
    BIO_write(bio, input, input_len);
    BIO_flush(bio);
    
    /* Get pointer to encoded data */
    BIO_get_mem_ptr(bio, &buffer_ptr);
    
    /* Copy to output string */
    *output = malloc(buffer_ptr->length + 1);
    if (*output == NULL) {
        fprintf(stderr, "Error: Memory allocation failed\n");
        BIO_free_all(bio);
        return -1;
    }
    
    memcpy(*output, buffer_ptr->data, buffer_ptr->length);
    (*output)[buffer_ptr->length] = '\0';
    
    BIO_free_all(bio);
    return 0;
}

int agro_base64_decode(
    const char *input,
    unsigned char **output,
    size_t *output_len
) {
    BIO *bio, *b64;
    size_t input_len = strlen(input);
    
    /* Allocate output buffer (decoded data is always smaller) */
    *output = malloc(input_len);
    if (*output == NULL) {
        fprintf(stderr, "Error: Memory allocation failed\n");
        return -1;
    }
    
    /* Create Base64 decoding BIO chain */
    bio = BIO_new_mem_buf((void *)input, input_len);
    b64 = BIO_new(BIO_f_base64());
    bio = BIO_push(b64, bio);
    
    /* Don't expect newlines */
    BIO_set_flags(bio, BIO_FLAGS_BASE64_NO_NL);
    
    /* Decode */
    *output_len = BIO_read(bio, *output, input_len);
    
    BIO_free_all(bio);
    
    if (*output_len <= 0) {
        fprintf(stderr, "Error: Base64 decoding failed\n");
        free(*output);
        *output = NULL;
        return -1;
    }
    
    return 0;
}

int agro_save_pem(
    const char *filename,
    const char *label,
    const unsigned char *data,
    size_t data_len
) {
    FILE *fp = fopen(filename, "w");
    if (fp == NULL) {
        fprintf(stderr, "Error: Cannot open file for writing: %s\n", filename);
        return -1;
    }
    
    /* Encode data to Base64 */
    char *b64_data = NULL;
    if (agro_base64_encode(data, data_len, &b64_data) != 0) {
        fclose(fp);
        return -1;
    }
    
    /* Write PEM format: header + base64 (with line breaks) + footer */
    fprintf(fp, "-----BEGIN %s-----\n", label);
    
    /* Write Base64 with 64-character line wrapping */
    size_t b64_len = strlen(b64_data);
    for (size_t i = 0; i < b64_len; i += 64) {
        size_t chunk_len = (b64_len - i < 64) ? (b64_len - i) : 64;
        fprintf(fp, "%.*s\n", (int)chunk_len, b64_data + i);
    }
    
    fprintf(fp, "-----END %s-----\n", label);
    
    free(b64_data);
    fclose(fp);
    
    return 0;
}

int agro_sha256_hex(
    const unsigned char *data,
    size_t data_len,
    char *hex_output
) {
    unsigned char hash[SHA256_DIGEST_LENGTH];
    
    /* Calculate SHA-256 hash */
    SHA256(data, data_len, hash);
    
    /* Convert to hexadecimal string */
    for (int i = 0; i < SHA256_DIGEST_LENGTH; i++) {
        sprintf(hex_output + (i * 2), "%02x", hash[i]);
    }
    hex_output[SHA256_DIGEST_LENGTH * 2] = '\0';
    
    return 0;
}

int agro_compress(
    const unsigned char *plaintext,
    size_t plaintext_len,
    unsigned char **compressed,
    size_t *compressed_len
) {
    int ret;
    z_stream stream;
    unsigned char *output_buffer = NULL;
    size_t output_size = 0;
    
    if (plaintext == NULL || plaintext_len == 0 || compressed == NULL || compressed_len == NULL) {
        fprintf(stderr, "Error: Invalid compression parameters\n");
        return -1;
    }
    
    /* Initialize zlib stream */
    memset(&stream, 0, sizeof(stream));
    stream.zalloc = Z_NULL;
    stream.zfree = Z_NULL;
    stream.opaque = Z_NULL;
    
    /* Initialize deflate with compression level 9 (best compression) */
    ret = deflateInit2(&stream, Z_BEST_COMPRESSION, Z_DEFLATED, 
                       15 + 16, 8, Z_DEFAULT_STRATEGY);  /* +16 for gzip format */
    if (ret != Z_OK) {
        fprintf(stderr, "Error: zlib deflateInit2 failed: %d\n", ret);
        return -1;
    }
    
    /* Allocate output buffer (worst case: slightly larger than input) */
    output_size = deflateBound(&stream, plaintext_len);
    output_buffer = malloc(output_size);
    if (output_buffer == NULL) {
        fprintf(stderr, "Error: Memory allocation failed for compression\n");
        deflateEnd(&stream);
        return -1;
    }
    
    /* Set input/output buffers */
    stream.avail_in = plaintext_len;
    stream.next_in = (unsigned char *)plaintext;
    stream.avail_out = output_size;
    stream.next_out = output_buffer;
    
    /* Compress data */
    ret = deflate(&stream, Z_FINISH);
    if (ret != Z_STREAM_END) {
        fprintf(stderr, "Error: zlib deflate failed: %d\n", ret);
        free(output_buffer);
        deflateEnd(&stream);
        return -1;
    }
    
    *compressed = output_buffer;
    *compressed_len = stream.total_out;
    
    deflateEnd(&stream);
    
    return 0;
}

int agro_decompress(
    const unsigned char *compressed,
    size_t compressed_len,
    unsigned char **decompressed,
    size_t *decompressed_len
) {
    int ret;
    z_stream stream;
    unsigned char *output_buffer = NULL;
    size_t output_size = 4096;  /* Start with 4KB, grow as needed */
    size_t total_output = 0;
    
    if (compressed == NULL || compressed_len == 0 || decompressed == NULL || decompressed_len == NULL) {
        fprintf(stderr, "Error: Invalid decompression parameters\n");
        return -1;
    }
    
    /* Initialize zlib stream */
    memset(&stream, 0, sizeof(stream));
    stream.zalloc = Z_NULL;
    stream.zfree = Z_NULL;
    stream.opaque = Z_NULL;
    
    /* Initialize inflate with gzip format support */
    ret = inflateInit2(&stream, 15 + 16);  /* +16 for gzip format */
    if (ret != Z_OK) {
        fprintf(stderr, "Error: zlib inflateInit2 failed: %d\n", ret);
        return -1;
    }
    
    /* Allocate initial output buffer */
    output_buffer = malloc(output_size);
    if (output_buffer == NULL) {
        fprintf(stderr, "Error: Memory allocation failed for decompression\n");
        inflateEnd(&stream);
        return -1;
    }
    
    /* Set input */
    stream.avail_in = compressed_len;
    stream.next_in = (unsigned char *)compressed;
    
    /* Decompress data */
    do {
        stream.avail_out = output_size - total_output;
        stream.next_out = output_buffer + total_output;
        
        ret = inflate(&stream, Z_NO_FLUSH);
        if (ret != Z_OK && ret != Z_STREAM_END) {
            fprintf(stderr, "Error: zlib inflate failed: %d\n", ret);
            free(output_buffer);
            inflateEnd(&stream);
            return -1;
        }
        
        total_output = stream.total_out;
        
        /* Grow buffer if needed */
        if (ret != Z_STREAM_END && stream.avail_out == 0) {
            output_size *= 2;
            unsigned char *new_buffer = realloc(output_buffer, output_size);
            if (new_buffer == NULL) {
                fprintf(stderr, "Error: Memory reallocation failed for decompression\n");
                free(output_buffer);
                inflateEnd(&stream);
                return -1;
            }
            output_buffer = new_buffer;
        }
    } while (ret != Z_STREAM_END);
    
    *decompressed = output_buffer;
    *decompressed_len = total_output;
    
    inflateEnd(&stream);
    
    return 0;
}
