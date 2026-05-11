/**
 * agro-crypt: Agricultural Cryptographic Certificate Tool
 * Main Program Entry Point
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

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <getopt.h>
#include "agro-crypt.h"

/**
 * Program version information
 */
#define AGRO_CRYPT_VERSION "1.0.0"

/**
 * QR code separator used to split certificate and key data
 */
#define QR_SEPARATOR ":$$:"

/**
 * Display program usage information
 * 
 * This function prints help text explaining all command-line options and
 * provides usage examples.
 */
static void print_usage(const char *program_name) {
    printf("agro-crypt v%s\n", AGRO_CRYPT_VERSION);
    printf("Copyright (c) Ronan Le Meillat - SCTG Development 2008-2012\n");
    printf("Licensed under the MIT License\n\n");
    
    printf("Usage: %s [OPTIONS]\n\n", program_name);
    
    printf("Options:\n");
    printf("  --generate          Generate a new signed ECC certificate and encode as QR\n");
    printf("  --decode            Decode a QR code from JPEG or PNG and decrypt certificate\n");
    printf("  --ca <file>         CA certificate file in PEM format (required)\n");
    printf("  --pin <code>        4-digit PIN or ASCII password (min 4 chars, required)\n");
    printf("  --out-dir <path>    Output directory (required)\n");
    printf("  --in-jpeg <file>    Input JPEG file (for --decode; mutually exclusive with --in-png and --in-txt)\n");
    printf("  --in-png <file>     Input PNG file (for --decode, PNG recommended over JPEG; mutually exclusive with --in-txt)\n");
    printf("  --in-txt <text>     Use provided QR text (decoded externally) instead of image\n");
    printf("  --cn <name>         Optional Common Name (CN) to use for generated certificate\n");
    printf("  --help              Display this help message\n\n");
    
    printf("Examples:\n");
    printf("  Generate mode:\n");
    printf("    %s --generate --ca ca.pem --pin 1234 --out-dir ./output --cn \"Device-001\"\n\n", program_name);
    printf("  Decode mode:\n");
    printf("    %s --decode --ca ca.pem --pin 1234 --out-dir ./output --in-jpeg qr.jpg\n\n", program_name);
    printf("  Decode from text (external QR decoder):\n");
    printf("    %s --decode --ca ca.pem --pin 1234 --out-dir ./output --in-txt \"<cert_b64>:$$:<key_b64>\"\n\n", program_name);
    
    printf("Notes:\n");
    printf("  - PIN must be at least 4 ASCII characters (digits 0-9 recommended)\n");
    printf("  - Generate mode creates: <hash>.pem (certificate + key), qrcode.svg\n");
    printf("  - Decode mode extracts certificate and key from QR code to PEM files\n");
    printf("  - Certificate uses ECC NIST P-192 curve, signed with RSA SHA-256\n");
}

/**
 * Validate PIN format
 * 
 * Checks that the PIN is at least 4 characters long and contains only
 * 7-bit ASCII characters.
 * 
 * @param pin PIN string to validate
 * @return 1 if valid, 0 if invalid
 */
static int validate_pin(const char *pin) {
    if (pin == NULL || strlen(pin) < 4) {
        return 0;
    }
    
    /* Check that all characters are 7-bit ASCII */
    for (size_t i = 0; i < strlen(pin); i++) {
        if ((unsigned char)pin[i] > 127) {
            return 0;
        }
    }
    
    return 1;
}

/* Return non-zero if `len` bytes of `s` look like a Base64 string */
static int is_base64_string(const char *s, size_t len)
{
    if (!s || len == 0)
        return 0;
    for (size_t i = 0; i < len; i++) {
        unsigned char c = (unsigned char)s[i];
        if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
              (c >= '0' && c <= '9') || c == '+' || c == '/' || c == '='))
            return 0;
    }
    return 1;
}

/**
 * Generate mode: Create certificate, encrypt, and encode as QR
 * 
 * This function performs the complete certificate generation workflow:
 * 1. Generate ECC P-192 certificate signed by CA
 * 2. Encrypt certificate and key with AES-256 using PIN
 * 3. Encode encrypted data as Base64
 * 4. Create QR code with format: <cert_b64>:$$:<key_b64>
 * 5. Save PEM files and QR code SVG
 * 
 * @param ca_path Path to CA certificate
 * @param pin PIN for encryption
 * @param out_dir Output directory
 * @return 0 on success, 1 on error
 */
static int mode_generate(const char *ca_path, const char *pin, const char *out_dir, const char *cn) {
    int ret = 1;
    unsigned char *cert_der = NULL;
    unsigned char *key_der = NULL;
    unsigned char *cert_encrypted = NULL;
    unsigned char *key_encrypted = NULL;
    unsigned char *cert_compressed = NULL;
    unsigned char *key_compressed = NULL;
    char *cert_b64 = NULL;
    char *key_b64 = NULL;
    char *qr_text = NULL;
    size_t cert_der_len = 0, key_der_len = 0;
    size_t cert_enc_len = 0, key_enc_len = 0;
    size_t cert_comp_len = 0, key_comp_len = 0;
    char cert_hash[65] = {0};
    char pem_path[512];
    char qr_path[512];
    
    printf("=== Generate Mode ===\n");
    
    /* Construct CA key path (assumes ca.key in same dir as ca.pem) */
    char ca_key_path[512];
    snprintf(ca_key_path, sizeof(ca_key_path), "%s", ca_path);
    char *ext = strrchr(ca_key_path, '.');
    if (ext != NULL) {
        strcpy(ext, ".key");
    } else {
        strcat(ca_key_path, ".key");
    }
    
    printf("Step 1/8: Generating ECC P-192 certificate...\n");
    if (agro_generate_signed_cert(ca_path, ca_key_path, &cert_der, &cert_der_len,
                                   &key_der, &key_der_len, cert_hash, cn) != 0) {
        fprintf(stderr, "Error: Failed to generate certificate\n");
        goto cleanup;
    }
    printf("  Certificate hash: %s\n", cert_hash);
    
    printf("Step 2/8: Compressing certificate DER...\n");
    if (agro_compress(cert_der, cert_der_len, &cert_compressed, &cert_comp_len) != 0) {
        fprintf(stderr, "Error: Failed to compress certificate\n");
        goto cleanup;
    }
    printf("  Original: %zu bytes, Compressed: %zu bytes (%.1f%% reduction)\n", 
           cert_der_len, cert_comp_len, 100.0 * (1.0 - (double)cert_comp_len / cert_der_len));
    
    printf("Step 3/8: Compressing private key DER...\n");
    if (agro_compress(key_der, key_der_len, &key_compressed, &key_comp_len) != 0) {
        fprintf(stderr, "Error: Failed to compress key\n");
        goto cleanup;
    }
    printf("  Original: %zu bytes, Compressed: %zu bytes (%.1f%% reduction)\n", 
           key_der_len, key_comp_len, 100.0 * (1.0 - (double)key_comp_len / key_der_len));
    
    printf("Step 4/8: Encrypting compressed certificate with AES-256...\n");
    if (agro_encrypt_aes256(cert_compressed, cert_comp_len, pin, &cert_encrypted, &cert_enc_len) != 0) {
        fprintf(stderr, "Error: Failed to encrypt certificate\n");
        goto cleanup;
    }
    
    printf("Step 5/8: Encrypting compressed private key with AES-256...\n");
    if (agro_encrypt_aes256(key_compressed, key_comp_len, pin, &key_encrypted, &key_enc_len) != 0) {
        fprintf(stderr, "Error: Failed to encrypt key\n");
        goto cleanup;
    }
    
    printf("Step 6/8: Encoding encrypted data to Base64...\n");
    if (agro_base64_encode(cert_encrypted, cert_enc_len, &cert_b64) != 0) {
        fprintf(stderr, "Error: Failed to encode certificate to Base64\n");
        goto cleanup;
    }
    if (agro_base64_encode(key_encrypted, key_enc_len, &key_b64) != 0) {
        fprintf(stderr, "Error: Failed to encode key to Base64\n");
        goto cleanup;
    }
    
    printf("Step 7/8: Creating QR code text...\n");
    /* Allocate buffer for: cert_b64 + separator + key_b64 + null */
    size_t qr_text_len = strlen(cert_b64) + strlen(QR_SEPARATOR) + strlen(key_b64) + 1;
    qr_text = malloc(qr_text_len);
    if (qr_text == NULL) {
        fprintf(stderr, "Error: Memory allocation failed\n");
        goto cleanup;
    }
    snprintf(qr_text, qr_text_len, "%s%s%s", cert_b64, QR_SEPARATOR, key_b64);
    printf("  QR text length: %zu characters\n", strlen(qr_text));
    // printf("  QR text content:\n%s\n", qr_text);
    printf("Step 8/8: Generating QR code SVG and PNG...\n");
    snprintf(qr_path, sizeof(qr_path), "%s/%s.svg", out_dir, cert_hash);
    if (agro_generate_qr_svg(qr_text, qr_path) != 0) {
        fprintf(stderr, "Error: Failed to generate QR SVG\n");
        goto cleanup;
    }
    printf("  QR SVG saved: %s\n", qr_path);
    
    snprintf(qr_path, sizeof(qr_path), "%s/%s.png", out_dir, cert_hash);
    if (agro_generate_qr_png(qr_text, qr_path) != 0) {
        fprintf(stderr, "Error: Failed to generate QR PNG\n");
        goto cleanup;
    }
    printf("  QR PNG saved: %s\n", qr_path);
    
    /* Save PEM files */
    printf("Saving PEM files...\n");
    snprintf(pem_path, sizeof(pem_path), "%s/%s-cert.pem", out_dir, cert_hash);
    if (agro_save_pem(pem_path, "CERTIFICATE", cert_der, cert_der_len) != 0) {
        fprintf(stderr, "Error: Failed to save certificate PEM\n");
        goto cleanup;
    }
    printf("  Certificate PEM: %s\n", pem_path);
    
    snprintf(pem_path, sizeof(pem_path), "%s/%s-key.pem", out_dir, cert_hash);
    if (agro_save_pem(pem_path, "EC PRIVATE KEY", key_der, key_der_len) != 0) {
        fprintf(stderr, "Error: Failed to save key PEM\n");
        goto cleanup;
    }
    printf("  Private key PEM: %s\n", pem_path);
    
    printf("\n=== Generation Complete ===\n");
    ret = 0;
    
cleanup:
    free(cert_der);
    free(key_der);
    free(cert_encrypted);
    free(key_encrypted);
    free(cert_compressed);
    free(key_compressed);
    free(cert_b64);
    free(key_b64);
    free(qr_text);
    
    return ret;
}

/**
 * Decode mode: Read QR from JPEG/PNG or use provided QR text, decrypt, and save certificate
 * 
 * This function performs the complete decoding workflow:
 * 1. Load JPEG/PNG image and decode QR code OR use provided QR text (qr_input_txt)
 * 2. Split QR text by separator :$$:
 * 3. Decode Base64 to binary
 * 4. Decrypt certificate and key using PIN
 * 5. Save as PEM files
 * 
 * @param image_path Path to input JPEG or PNG file (may be NULL when qr_input_txt is used)
 * @param is_png 1 if PNG, 0 if JPEG (ignored when qr_input_txt is used)
 * @param pin PIN for decryption
 * @param out_dir Output directory
 * @param qr_input_txt If non-NULL, use this string as the QR payload instead of decoding an image
 * @return 0 on success, 1 on error
 */
static int mode_decode(const char *image_path, int is_png, const char *pin, const char *out_dir, const char *qr_input_txt) {
    int ret = 1;
    char *qr_text = NULL;
    char *cert_b64 = NULL;
    char *key_b64 = NULL;
    unsigned char *cert_compressed = NULL;
    unsigned char *key_compressed = NULL;
    unsigned char *cert_encrypted = NULL;
    unsigned char *key_encrypted = NULL;
    unsigned char *cert_decrypted = NULL;
    unsigned char *key_decrypted = NULL;
    size_t cert_comp_len = 0, key_comp_len = 0;
    size_t cert_enc_len = 0, key_enc_len = 0;
    size_t cert_dec_len = 0, key_dec_len = 0;
    char cert_hash[65] = {0};
    char pem_path[512];
    
    printf("=== Decode Mode ===\n");
    
    if (qr_input_txt != NULL) {
        printf("Step 1/7: Using provided QR text (from --in-txt)...\n");
        qr_text = strdup(qr_input_txt);
        if (qr_text == NULL) {
            fprintf(stderr, "Error: Memory allocation failed\n");
            goto cleanup;
        }
    } else {
        printf("Step 1/7: Decoding QR code from %s...\n", is_png ? "PNG" : "JPEG");
        if (is_png) {
            if (agro_decode_qr_png(image_path, &qr_text) != 0) {
                fprintf(stderr, "Error: Failed to decode QR code from PNG\n");
                goto cleanup;
            }
        } else {
            if (agro_decode_qr_jpeg(image_path, &qr_text) != 0) {
                fprintf(stderr, "Error: Failed to decode QR code from JPEG\n");
                goto cleanup;
            }
        }
    }
    printf("  QR text length: %zu characters\n", qr_text ? strlen(qr_text) : 0); 
    
    printf("Step 2/7: Splitting QR text...\n");
    char *separator_pos = strstr(qr_text, QR_SEPARATOR);
    char *sep_end = NULL;

    if (separator_pos != NULL) {
        sep_end = separator_pos + strlen(QR_SEPARATOR);
    } else {
        /* Fallback: handle shell expansion of "$$" -> PID (e.g. :12345:)
           Look for a colon + digits + colon that separates two Base64-like parts. */
        char *p = qr_text;
        while ((p = strchr(p, ':')) != NULL) {
            char *q = p + 1;
            char *r = q;
            while (*r && isdigit((unsigned char)*r))
                r++;
            if (r > q && *r == ':') {
                size_t left_len = p - qr_text;
                size_t right_len = strlen(r + 1);
                if (left_len > 0 && right_len > 0 &&
                    is_base64_string(qr_text, left_len) &&
                    is_base64_string(r + 1, right_len)) {
                    separator_pos = p;
                    sep_end = r + 1;
                    fprintf(stderr, "Warning: separator '%s' not found — using numeric separator found in input (shell expanded '$$').\n", QR_SEPARATOR);
                    break;
                }
            }
            p = (r > p) ? r : p + 1;
        }
    }

    if (separator_pos == NULL || sep_end == NULL) {
        fprintf(stderr, "Error: QR text does not contain separator '%s'\n", QR_SEPARATOR);
        goto cleanup;
    }

    /* Extract certificate and key Base64 strings */
    size_t cert_b64_len = separator_pos - qr_text;
    cert_b64 = malloc(cert_b64_len + 1);
    if (cert_b64 == NULL) {
        fprintf(stderr, "Error: Memory allocation failed\n");
        goto cleanup;
    }
    memcpy(cert_b64, qr_text, cert_b64_len);
    cert_b64[cert_b64_len] = '\0';

    key_b64 = strdup(sep_end);
    if (key_b64 == NULL) {
        fprintf(stderr, "Error: Memory allocation failed\n");
        goto cleanup;
    }
    
    printf("Step 3/7: Decoding Base64...\n");
    if (agro_base64_decode(cert_b64, &cert_encrypted, &cert_enc_len) != 0) {
        fprintf(stderr, "Error: Failed to decode certificate from Base64\n");
        goto cleanup;
    }
    if (agro_base64_decode(key_b64, &key_encrypted, &key_enc_len) != 0) {
        fprintf(stderr, "Error: Failed to decode key from Base64\n");
        goto cleanup;
    }
    
    printf("Step 4/7: Decrypting with PIN...\n");
    if (agro_decrypt_aes256(cert_encrypted, cert_enc_len, pin, &cert_compressed, &cert_comp_len) != 0) {
        fprintf(stderr, "Error: Failed to decrypt certificate (wrong PIN?)\n");
        goto cleanup;
    }
    if (agro_decrypt_aes256(key_encrypted, key_enc_len, pin, &key_compressed, &key_comp_len) != 0) {
        fprintf(stderr, "Error: Failed to decrypt key (wrong PIN?)\n");
        goto cleanup;
    }
    
    printf("Step 5/7: Decompressing data...\n");
    if (agro_decompress(cert_compressed, cert_comp_len, &cert_decrypted, &cert_dec_len) != 0) {
        fprintf(stderr, "Error: Failed to decompress certificate\n");
        goto cleanup;
    }
    printf("  Certificate: %zu bytes (compressed) -> %zu bytes\n", cert_comp_len, cert_dec_len);
    if (agro_decompress(key_compressed, key_comp_len, &key_decrypted, &key_dec_len) != 0) {
        fprintf(stderr, "Error: Failed to decompress key\n");
        goto cleanup;
    }
    printf("  Private key: %zu bytes (compressed) -> %zu bytes\n", key_comp_len, key_dec_len);
    
    printf("Step 6/7: Verifying decompressed data...\n");
    printf("  Certificate: %zu bytes\n", cert_dec_len);
    printf("  Private key: %zu bytes\n", key_dec_len);
    
    printf("Step 7/7: Saving PEM files...\n");
    
    /* Calculate certificate hash */
    agro_sha256_hex(cert_decrypted, cert_dec_len, cert_hash);
    printf("  Certificate hash: %s\n", cert_hash);
    
    snprintf(pem_path, sizeof(pem_path), "%s/%s-cert.pem", out_dir, cert_hash);
    if (agro_save_pem(pem_path, "CERTIFICATE", cert_decrypted, cert_dec_len) != 0) {
        fprintf(stderr, "Error: Failed to save certificate PEM\n");
        goto cleanup;
    }
    printf("  Certificate PEM: %s\n", pem_path);
    
    snprintf(pem_path, sizeof(pem_path), "%s/%s-key.pem", out_dir, cert_hash);
    if (agro_save_pem(pem_path, "EC PRIVATE KEY", key_decrypted, key_dec_len) != 0) {
        fprintf(stderr, "Error: Failed to save key PEM\n");
        goto cleanup;
    }
    printf("  Private key PEM: %s\n", pem_path);
    
    printf("\n=== Decoding Complete ===\n");
    ret = 0;
    
cleanup:
    free(qr_text);
    free(cert_b64);
    free(key_b64);
    free(cert_compressed);
    free(key_compressed);
    free(cert_encrypted);
    free(key_encrypted);
    free(cert_decrypted);
    free(key_decrypted);
    
    return ret;
}

/**
 * Main program entry point
 * 
 * Parses command-line arguments and dispatches to generate or decode mode.
 */
int main(int argc, char **argv) {
    int opt;
    int mode = 0; /* 0=none, 1=generate, 2=decode */
    const char *ca_path = NULL;
    const char *pin = NULL;
    const char *out_dir = NULL;
    const char *in_jpeg = NULL;
    const char *in_png = NULL;
    const char *in_txt = NULL;
    const char *cn = NULL; 
    
    /* Long options for getopt_long */
    static struct option long_options[] = {
        {"generate", no_argument,       NULL, 'g'},
        {"decode",   no_argument,       NULL, 'd'},
        {"ca",       required_argument, NULL, 'c'},
        {"pin",      required_argument, NULL, 'p'},
        {"out-dir",  required_argument, NULL, 'o'},
        {"in-jpeg",  required_argument, NULL, 'i'},
        {"in-png",   required_argument, NULL, 'n'},
        {"in-txt",   required_argument, NULL, 't'},
        {"cn",       required_argument, NULL, 'm'},
        {"help",     no_argument,       NULL, 'h'},
        {0, 0, 0, 0}
    }; 
    
    /* Parse command-line options */
    while ((opt = getopt_long(argc, argv, "gdc:p:o:i:n:t:m:h", long_options, NULL)) != -1) {
        switch (opt) {
            case 'g':
                if (mode != 0) {
                    fprintf(stderr, "Error: --generate and --decode are mutually exclusive\n");
                    print_usage(argv[0]);
                    return 1;
                }
                mode = 1;
                break;
            case 'd':
                if (mode != 0) {
                    fprintf(stderr, "Error: --generate and --decode are mutually exclusive\n");
                    print_usage(argv[0]);
                    return 1;
                }
                mode = 2;
                break;
            case 'c':
                ca_path = optarg;
                break;
            case 'p':
                pin = optarg;
                break;
            case 'o':
                out_dir = optarg;
                break;
            case 'i':
                in_jpeg = optarg;
                break;
            case 'n':
                in_png = optarg;
                break;
            case 't':
                in_txt = optarg;
                break;
            case 'm':
                cn = optarg;
                break;
            case 'h':
            default:
                print_usage(argv[0]);
                return (opt == 'h') ? 0 : 1; 
        }
    }
    
    /* Validate required options */
    if (mode == 0) {
        fprintf(stderr, "Error: Must specify --generate or --decode\n\n");
        print_usage(argv[0]);
        return 1;
    }
    
    if (ca_path == NULL) {
        fprintf(stderr, "Error: --ca is required\n\n");
        print_usage(argv[0]);
        return 1;
    }
    
    if (pin == NULL) {
        fprintf(stderr, "Error: --pin is required\n\n");
        print_usage(argv[0]);
        return 1;
    }
    
    if (!validate_pin(pin)) {
        fprintf(stderr, "Error: PIN must be at least 4 ASCII characters\n\n");
        print_usage(argv[0]);
        return 1;
    }
    
    if (out_dir == NULL) {
        fprintf(stderr, "Error: --out-dir is required\n\n");
        print_usage(argv[0]);
        return 1;
    }
    
    if (mode == 2 && in_jpeg == NULL && in_png == NULL && in_txt == NULL) {
        fprintf(stderr, "Error: --in-jpeg, --in-png or --in-txt is required for --decode mode\n\n");
        print_usage(argv[0]);
        return 1;
    }
    if (mode == 2) {
        int count = (in_jpeg != NULL) + (in_png != NULL) + (in_txt != NULL);
        if (count > 1) {
            fprintf(stderr, "Error: only one of --in-jpeg, --in-png or --in-txt may be specified\n\n");
            print_usage(argv[0]);
            return 1;
        }
    }

    /* --cn is only meaningful for generate mode */
    if (cn != NULL && mode != 1) {
        fprintf(stderr, "Error: --cn is only valid with --generate\n\n");
        print_usage(argv[0]);
        return 1;
    }
    
    /* Execute requested mode */
    if (mode == 1) {
        return mode_generate(ca_path, pin, out_dir, cn);
    } else {
        const char *image_path = (in_png != NULL) ? in_png : in_jpeg;
        int is_png = (in_png != NULL) ? 1 : 0;
        return mode_decode(image_path, is_png, pin, out_dir, in_txt);
    }
}

