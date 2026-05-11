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
#include "agro-crypt.h"

/**
 * OpenSSL "Salted__" magic header for encrypted files
 * This matches the format used by "openssl enc" command
 */
#define OPENSSL_ENC_MAGIC "Salted__"
#define SALT_SIZE 8

/**
 * Initialize OpenSSL library
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
static X509 *create_certificate(EVP_PKEY *pkey) {
    X509 *cert = NULL;
    X509_NAME *name = NULL;
    
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
    
    /* Set validity period: now to +365 days */
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
                               (unsigned char *)"Agro-Crypt Certificate", -1, -1, 0);
    
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
 * @param ca_cert CA certificate (for issuer 

