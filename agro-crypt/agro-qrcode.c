/**
 * agro-crypt: QR Code Operations Module
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
 * This module handles QR code generation and decoding:
 * - Generate QR codes as SVG files using libqrencode
 * - Decode QR codes from JPEG images using zbar 0.3 (zebra API)
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <qrencode.h>
#include <zbar.h>        /* zbar 0.10 with modern API */
#include <jpeglib.h>
#include <png.h>
#include "agro-crypt.h"

#define JPEG_LIB_VERSION 70 
#define JPEG_TRUE 1
#define JPEG_FALSE 0


/**
 * QR code version and error correction settings
 * Version 0 lets libqrencode automatically choose the smallest version that fits
 * Level L provides only 7% error correction but allows smaller QR codes
 * This is necessary for compatibility with older zbar 0.3 scanner
 */
#define QR_VERSION 0
#define QR_ECLEVEL QR_ECLEVEL_L

/**
 * Generate SVG path data for a QR code module (pixel)
 * 
 * This function creates an SVG rectangle element for each black module
 * in the QR code matrix.
 * 
 * @param fp Output file pointer
 * @param x X coordinate (column)
 * @param y Y coordinate (row)
 * @param module_size Size of each module in SVG units
 */
static void svg_write_module(FILE *fp, int x, int y, int module_size) {
    fprintf(fp, "<rect x=\"%d\" y=\"%d\" width=\"%d\" height=\"%d\"/>\n",
            x * module_size, y * module_size, module_size, module_size);
}

int agro_generate_qr_svg(
    const char *text,
    const char *output_path
) {
    QRcode *qr = NULL;
    FILE *fp = NULL;
    
    /* Generate QR code with specified version and error correction */
    /* Using 8-bit mode which is simpler and handles arbitrary binary data */
    qr = QRcode_encodeString8bit(text, QR_VERSION, QR_ECLEVEL);
    if (qr == NULL) {
        fprintf(stderr, "Error: Failed to encode QR code (text length: %zu bytes, errno: %d)\n", 
                strlen(text), errno);
        return -1;
    }
    
    /* Open output SVG file */
    fp = fopen(output_path, "w");
    if (fp == NULL) {
        fprintf(stderr, "Error: Cannot open output file: %s\n", output_path);
        QRcode_free(qr);
        return -1;
    }
    
    /* Calculate SVG dimensions */
    int width = qr->width;
    int module_size = 20;  /* Each QR module is 20 SVG units (doubled for better scanner detection) */
    int margin = 4;        /* 4-module quiet zone around QR code */
    int svg_size = (width + 2 * margin) * module_size;
    
    /* Write SVG header */
    fprintf(fp, "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    fprintf(fp, "<svg xmlns=\"http://www.w3.org/2000/svg\" ");
    fprintf(fp, "version=\"1.1\" ");
    fprintf(fp, "width=\"%d\" height=\"%d\" ", svg_size, svg_size);
    fprintf(fp, "viewBox=\"0 0 %d %d\">\n", svg_size, svg_size);
    
    /* White background */
    fprintf(fp, "<rect x=\"0\" y=\"0\" width=\"%d\" height=\"%d\" fill=\"white\"/>\n",
            svg_size, svg_size);
    
    /* Black modules group */
    fprintf(fp, "<g fill=\"black\">\n");
    
    /* Iterate through QR code matrix and draw black modules */
    unsigned char *p = qr->data;
    for (int y = 0; y < width; y++) {
        for (int x = 0; x < width; x++) {
            /* Check if module is black (LSB = 1) */
            if (*p & 1) {
                svg_write_module(fp, x + margin, y + margin, module_size);
            }
            p++;
        }
    }
    
    fprintf(fp, "</g>\n");
    fprintf(fp, "</svg>\n");
    
    fclose(fp);
    QRcode_free(qr);
    
    printf("  QR code size: %dx%d modules\n", width, width);
    printf("  SVG size: %dx%d pixels\n", svg_size, svg_size);
    
    return 0;
}

/**
 * Generate QR code as PNG image using libpng
 */
int agro_generate_qr_png(
    const char *text,
    const char *output_path
) {
    QRcode *qr = NULL;
    FILE *fp = NULL;
    png_structp png_ptr = NULL;
    png_infop info_ptr = NULL;
    png_bytep *row_pointers = NULL;
    
    /* Generate QR code */
    qr = QRcode_encodeString8bit(text, QR_VERSION, QR_ECLEVEL);
    if (qr == NULL) {
        fprintf(stderr, "Error: Failed to encode QR code for PNG\n");
        return -1;
    }
    
    int width = qr->width;
    int module_size = 20;  /* Each QR module is 20 pixels (doubled for better scanner detection) */
    int margin = 4;        /* 4-module quiet zone */
    int png_width = (width + 2 * margin) * module_size;
    int png_height = png_width;
    
    /* Open output PNG file */
    fp = fopen(output_path, "wb");
    if (fp == NULL) {
        fprintf(stderr, "Error: Cannot open PNG file for writing: %s\n", output_path);
        QRcode_free(qr);
        return -1;
    }
    
    /* Initialize PNG structures */
    png_ptr = png_create_write_struct(PNG_LIBPNG_VER_STRING, NULL, NULL, NULL);
    if (png_ptr == NULL) {
        fprintf(stderr, "Error: Failed to create PNG write struct\n");
        fclose(fp);
        QRcode_free(qr);
        return -1;
    }
    
    info_ptr = png_create_info_struct(png_ptr);
    if (info_ptr == NULL) {
        fprintf(stderr, "Error: Failed to create PNG info struct\n");
        png_destroy_write_struct(&png_ptr, NULL);
        fclose(fp);
        QRcode_free(qr);
        return -1;
    }
    
    /* Set up error handling */
    if (setjmp(png_jmpbuf(png_ptr))) {
        fprintf(stderr, "Error: PNG write failed\n");
        png_destroy_write_struct(&png_ptr, &info_ptr);
        fclose(fp);
        QRcode_free(qr);
        if (row_pointers) {
            for (int y = 0; y < png_height; y++) {
                free(row_pointers[y]);
            }
            free(row_pointers);
        }
        return -1;
    }
    
    /* Set PNG file I/O */
    png_init_io(png_ptr, fp);
    
    /* Set PNG image properties: grayscale, 8-bit */
    png_set_IHDR(png_ptr, info_ptr, png_width, png_height, 8,
                 PNG_COLOR_TYPE_GRAY, PNG_INTERLACE_NONE,
                 PNG_COMPRESSION_TYPE_DEFAULT, PNG_FILTER_TYPE_DEFAULT);
    
    /* Write PNG header */
    png_write_info(png_ptr, info_ptr);
    
    /* Allocate row pointers */
    row_pointers = (png_bytep *)malloc(sizeof(png_bytep) * png_height);
    if (row_pointers == NULL) {
        fprintf(stderr, "Error: Memory allocation failed\n");
        png_destroy_write_struct(&png_ptr, &info_ptr);
        fclose(fp);
        QRcode_free(qr);
        return -1;
    }
    
    /* Allocate and fill row data */
    for (int y = 0; y < png_height; y++) {
        row_pointers[y] = (png_bytep)malloc(png_width);
        if (row_pointers[y] == NULL) {
            fprintf(stderr, "Error: Memory allocation failed\n");
            for (int i = 0; i < y; i++) {
                free(row_pointers[i]);
            }
            free(row_pointers);
            png_destroy_write_struct(&png_ptr, &info_ptr);
            fclose(fp);
            QRcode_free(qr);
            return -1;
        }
        
        /* Fill row with white background (255) */
        memset(row_pointers[y], 255, png_width);
    }
    
    /* Draw QR code modules */
    unsigned char *p = qr->data;
    for (int qr_y = 0; qr_y < width; qr_y++) {
        for (int qr_x = 0; qr_x < width; qr_x++) {
            if (*p & 1) {  /* Module is black */
                /* Draw module_size x module_size black pixels */
                int px_x = (qr_x + margin) * module_size;
                int px_y = (qr_y + margin) * module_size;
                
                for (int dy = 0; dy < module_size; dy++) {
                    for (int dx = 0; dx < module_size; dx++) {
                        row_pointers[px_y + dy][px_x + dx] = 0;  /* Black */
                    }
                }
            }
            p++;
        }
    }
    
    /* Write PNG image data */
    png_write_image(png_ptr, row_pointers);
    
    /* Write PNG end */
    png_write_end(png_ptr, NULL);
    
    /* Clean up */
    for (int y = 0; y < png_height; y++) {
        free(row_pointers[y]);
    }
    free(row_pointers);
    png_destroy_write_struct(&png_ptr, &info_ptr);
    fclose(fp);
    QRcode_free(qr);
    
    printf("  PNG size: %dx%d pixels\n", png_width, png_height);
    
    return 0;
}

/**
 * Load JPEG image into memory
 * 
 * This function uses libjpeg to decode a JPEG file into raw grayscale
 * pixel data suitable for QR code scanning.
 * 
 * @param jpeg_path Path to JPEG file
 * @param width Output: image width
 * @param height Output: image height
 * @param data Output: grayscale pixel data (caller must free)
 * @return 0 on success, -1 on error
 */
static int load_jpeg(const char *jpeg_path, int *width, int *height, unsigned char **data) {
    struct jpeg_decompress_struct cinfo;
    struct jpeg_error_mgr jerr;
    FILE *fp = NULL;
    JSAMPARRAY buffer;
    int row_stride;
    
    /* Open JPEG file */
    fp = fopen(jpeg_path, "rb");
    if (fp == NULL) {
        fprintf(stderr, "Error: Cannot open JPEG file: %s\n", jpeg_path);
        return -1;
    }
    
    /* Initialize JPEG decompression */
    cinfo.err = jpeg_std_error(&jerr);
    jpeg_create_decompress(&cinfo);
    jpeg_stdio_src(&cinfo, fp);
    
    /* Read JPEG header */
    jpeg_read_header(&cinfo, JPEG_TRUE);
    
    /* Force grayscale output for QR scanning */
    cinfo.out_color_space = JCS_GRAYSCALE;
    
    /* Start decompression */
    jpeg_start_decompress(&cinfo);
    
    *width = cinfo.output_width;
    *height = cinfo.output_height;
    row_stride = cinfo.output_width * cinfo.output_components;
    
    /* Allocate image buffer */
    *data = malloc(*width * *height);
    if (*data == NULL) {
        fprintf(stderr, "Error: Memory allocation failed\n");
        jpeg_destroy_decompress(&cinfo);
        fclose(fp);
        return -1;
    }
    
    /* Allocate row buffer */
    buffer = (*cinfo.mem->alloc_sarray)((j_common_ptr)&cinfo, JPOOL_IMAGE, row_stride, 1);
    
    /* Read scanlines */
    int row = 0;
    while (cinfo.output_scanline < cinfo.output_height) {
        jpeg_read_scanlines(&cinfo, buffer, 1);
        memcpy(*data + row * *width, buffer[0], *width);
        row++;
    }
    
    /* Clean up */
    jpeg_finish_decompress(&cinfo);
    jpeg_destroy_decompress(&cinfo);
    fclose(fp);
    
    return 0;
}

int agro_decode_qr_jpeg(
    const char *jpeg_path,
    char **decoded_text
) {
    int width, height;
    unsigned char *image_data = NULL;
    zbar_image_scanner_t *scanner = NULL;
    zbar_image_t *image = NULL;
    int ret = -1;
    
    /* Load JPEG image */
    printf("  Loading JPEG: %s\n", jpeg_path);
    if (load_jpeg(jpeg_path, &width, &height, &image_data) != 0) {
        return -1;
    }
    printf("  Image dimensions: %dx%d pixels\n", width, height);
    
    /* Enhance contrast by normalizing pixel values */
    unsigned char min_val = 255, max_val = 0;
    for (int i = 0; i < width * height; i++) {
        if (image_data[i] < min_val) min_val = image_data[i];
        if (image_data[i] > max_val) max_val = image_data[i];
    }
    printf("  Debug: image pixel range [%u, %u]\n", min_val, max_val);
    
    /* Normalize grayscale values to full range for better detection */
    if (max_val > min_val) {
        for (int i = 0; i < width * height; i++) {
            image_data[i] = (unsigned char)(((int)image_data[i] - min_val) * 255 / (max_val - min_val));
        }
        printf("  Debug: normalized pixel range [0, 255]\n");
    }
    
    /* Apply binary threshold to enhance QR code visibility */
    /* Calculate threshold as mean of pixel values */
    unsigned long sum = 0;
    for (int i = 0; i < width * height; i++) {
        sum += image_data[i];
    }
    unsigned int threshold = sum / (width * height);
    printf("  Debug: applying threshold %u for binarization...\n", threshold);
    
    for (int i = 0; i < width * height; i++) {
        image_data[i] = (image_data[i] >= threshold) ? 255 : 0;
    }
    
    /* Create ZBar scanner (modern zbar 0.10 API) */
    scanner = zbar_image_scanner_create();
    if (scanner == NULL) {
        fprintf(stderr, "Error: Failed to create ZBar scanner\n");
        free(image_data);
        return -1;
    }
    
    /* Configure scanner for better QR code detection */
    zbar_image_scanner_set_config(scanner, ZBAR_QRCODE, ZBAR_CFG_ENABLE, 1);
    
    /* Create ZBar image */
    image = zbar_image_create();
    if (image == NULL) {
        fprintf(stderr, "Error: Failed to create ZBar image\n");
        zbar_image_scanner_destroy(scanner);
        free(image_data);
        return -1;
    }
    
    /* Set image format to grayscale Y800 */
    /* Y800 is a fourcc code, convert string to unsigned int */
    unsigned int format = (((unsigned int)'Y') |
                           (((unsigned int)'8') << 8) |
                           (((unsigned int)'0') << 16) |
                           (((unsigned int)'0') << 24));
    zbar_image_set_format(image, format);
    
    /* Set image dimensions */
    zbar_image_set_size(image, width, height);
    
    /* Set image data - zbar will not free the data, we manage it */
    zbar_image_set_data(image, image_data, width * height, NULL);
    
    /* Scan for barcodes/QR codes */
    printf("  Scanning for QR codes...\n");
    printf("  Debug: Image format=0x%08x, size=%dx%d, data_size=%d bytes\n", 
           format, width, height, width * height);
    int n = zbar_scan_image(scanner, image);
    printf("  Debug: zbar_scan_image returned %d\n", n);
    if (n < 0) {
        fprintf(stderr, "Error: ZBar scanning failed (return code %d)\n", n);
        goto cleanup;
    }
    
    if (n == 0) {
        fprintf(stderr, "Error: No QR codes found in image\n");
        fprintf(stderr, "  Hint: JPEG compression may lose QR code precision\n");
        fprintf(stderr, "  Hint: Try using PNG format instead: convert in.jpg out.png\n");
        fprintf(stderr, "  Hint: Or re-encode with ImageMagick: magick in.jpg -depth 8 -quality 100 out.jpg\n");
        goto cleanup;
    }
    
    printf("  Found %d symbol(s)\n", n);
    
    /* Extract first symbol (should be QR code) */
    const zbar_symbol_t *symbol = zbar_image_first_symbol(image);
    if (symbol == NULL) {
        fprintf(stderr, "Error: Could not retrieve symbol data\n");
        goto cleanup;
    }
    
    /* Get decoded data */
    const char *data = zbar_symbol_get_data(symbol);
    if (data == NULL) {
        fprintf(stderr, "Error: Symbol data is empty\n");
        goto cleanup;
    }
    
    /* Copy decoded text */
    *decoded_text = strdup(data);
    if (*decoded_text == NULL) {
        fprintf(stderr, "Error: Memory allocation failed\n");
        goto cleanup;
    }
    
    printf("  Decoded %zu bytes\n", strlen(*decoded_text));
    ret = 0;
    
cleanup:
    if (image) {
        zbar_image_destroy(image);
    }
    if (scanner) {
        zbar_image_scanner_destroy(scanner);
    }
    if (image_data) {
        free(image_data);
    }
    
    return ret;
}

/**
 * Load PNG image as grayscale
 */
static int load_png(const char *png_path, int *width, int *height, unsigned char **data) {
    FILE *fp = NULL;
    png_structp png_ptr = NULL;
    png_infop info_ptr = NULL;
    png_bytep *row_pointers = NULL;
    
    /* Open PNG file */
    fp = fopen(png_path, "rb");
    if (fp == NULL) {
        fprintf(stderr, "Error: Cannot open PNG file: %s\n", png_path);
        return -1;
    }
    
    /* Create PNG read structure */
    png_ptr = png_create_read_struct(PNG_LIBPNG_VER_STRING, NULL, NULL, NULL);
    if (png_ptr == NULL) {
        fprintf(stderr, "Error: Failed to create PNG read struct\n");
        fclose(fp);
        return -1;
    }
    
    /* Create PNG info structure */
    info_ptr = png_create_info_struct(png_ptr);
    if (info_ptr == NULL) {
        fprintf(stderr, "Error: Failed to create PNG info struct\n");
        png_destroy_read_struct(&png_ptr, NULL, NULL);
        fclose(fp);
        return -1;
    }
    
    /* Set error handling */
    if (setjmp(png_jmpbuf(png_ptr))) {
        fprintf(stderr, "Error: PNG read failed\n");
        png_destroy_read_struct(&png_ptr, &info_ptr, NULL);
        fclose(fp);
        return -1;
    }
    
    /* Set PNG file I/O */
    png_init_io(png_ptr, fp);
    
    /* Read PNG info */
    png_read_info(png_ptr, info_ptr);
    
    *width = png_get_image_width(png_ptr, info_ptr);
    *height = png_get_image_height(png_ptr, info_ptr);
    png_byte color_type = png_get_color_type(png_ptr, info_ptr);
    png_byte bit_depth = png_get_bit_depth(png_ptr, info_ptr);
    
    /* Convert palette/transparency to RGB if needed */
    if (color_type == PNG_COLOR_TYPE_PALETTE) {
        png_set_palette_to_rgb(png_ptr);
    }
    if (color_type == PNG_COLOR_TYPE_GRAY && bit_depth < 8) {
        png_set_expand_gray_1_2_4_to_8(png_ptr);
    }
    if (png_get_valid(png_ptr, info_ptr, PNG_INFO_tRNS)) {
        png_set_tRNS_to_alpha(png_ptr);
    }
    
    /* Convert to RGB or RGBA */
    if (color_type == PNG_COLOR_TYPE_RGB ||
        color_type == PNG_COLOR_TYPE_GRAY ||
        color_type == PNG_COLOR_TYPE_PALETTE) {
        png_set_filler(png_ptr, 0xFF, PNG_FILLER_AFTER);
    }
    if (color_type == PNG_COLOR_TYPE_GRAY || color_type == PNG_COLOR_TYPE_GRAY_ALPHA) {
        png_set_gray_to_rgb(png_ptr);
    }
    
    png_read_update_info(png_ptr, info_ptr);
    
    /* Allocate row pointers */
    row_pointers = (png_bytep *)malloc(sizeof(png_bytep) * (*height));
    for (int y = 0; y < *height; y++) {
        row_pointers[y] = (png_bytep)malloc(png_get_rowbytes(png_ptr, info_ptr));
    }
    
    /* Read PNG data */
    png_read_image(png_ptr, row_pointers);
    
    /* Convert RGB to grayscale */
    *data = malloc(*width * *height);
    if (*data == NULL) {
        fprintf(stderr, "Error: Memory allocation failed\n");
        goto png_cleanup;
    }
    
    int rowbytes = png_get_rowbytes(png_ptr, info_ptr);
    for (int y = 0; y < *height; y++) {
        for (int x = 0; x < *width; x++) {
            int pixel_idx = x * (rowbytes / *width);
            if (pixel_idx + 2 < rowbytes) {
                /* Convert RGB to grayscale using standard formula */
                unsigned char r = row_pointers[y][pixel_idx];
                unsigned char g = row_pointers[y][pixel_idx + 1];
                unsigned char b = row_pointers[y][pixel_idx + 2];
                (*data)[y * *width + x] = (unsigned char)(0.299 * r + 0.587 * g + 0.114 * b);
            }
        }
    }
    
png_cleanup:
    for (int y = 0; y < *height; y++) {
        free(row_pointers[y]);
    }
    free(row_pointers);
    png_destroy_read_struct(&png_ptr, &info_ptr, NULL);
    fclose(fp);
    
    return 0;
}

int agro_decode_qr_png(
    const char *png_path,
    char **decoded_text
) {
    int width, height;
    unsigned char *image_data = NULL;
    zbar_image_scanner_t *scanner = NULL;
    zbar_image_t *image = NULL;
    int ret = -1;
    
    /* Load PNG image */
    printf("  Loading PNG: %s\n", png_path);
    if (load_png(png_path, &width, &height, &image_data) != 0) {
        return -1;
    }
    printf("  Image dimensions: %dx%d pixels\n", width, height);
    
    /* Enhance contrast by normalizing pixel values */
    unsigned char min_val = 255, max_val = 0;
    for (int i = 0; i < width * height; i++) {
        if (image_data[i] < min_val) min_val = image_data[i];
        if (image_data[i] > max_val) max_val = image_data[i];
    }
    printf("  Debug: image pixel range [%u, %u]\n", min_val, max_val);
    
    /* Normalize grayscale values to full range for better detection */
    if (max_val > min_val) {
        for (int i = 0; i < width * height; i++) {
            image_data[i] = (unsigned char)(((int)image_data[i] - min_val) * 255 / (max_val - min_val));
        }
        printf("  Debug: normalized pixel range [0, 255]\n");
    }
    
    /* Apply binary threshold to enhance QR code visibility */
    /* Calculate threshold as mean of pixel values */
    unsigned long sum = 0;
    for (int i = 0; i < width * height; i++) {
        sum += image_data[i];
    }
    unsigned int threshold = sum / (width * height);
    printf("  Debug: applying threshold %u for binarization...\n", threshold);
    
    for (int i = 0; i < width * height; i++) {
        image_data[i] = (image_data[i] >= threshold) ? 255 : 0;
    }
    
    /* Create ZBar scanner (modern zbar 0.10 API) */
    scanner = zbar_image_scanner_create();
    if (scanner == NULL) {
        fprintf(stderr, "Error: Failed to create ZBar scanner\n");
        free(image_data);
        return -1;
    }
    
    /* Configure scanner for better QR code detection */
    zbar_image_scanner_set_config(scanner, ZBAR_QRCODE, ZBAR_CFG_ENABLE, 1);
    
    /* Create ZBar image */
    image = zbar_image_create();
    if (image == NULL) {
        fprintf(stderr, "Error: Failed to create ZBar image\n");
        zbar_image_scanner_destroy(scanner);
        free(image_data);
        return -1;
    }
    
    /* Set image format to grayscale Y800 */
    unsigned int format = (((unsigned int)'Y') |
                           (((unsigned int)'8') << 8) |
                           (((unsigned int)'0') << 16) |
                           (((unsigned int)'0') << 24));
    zbar_image_set_format(image, format);
    zbar_image_set_size(image, width, height);
    zbar_image_set_data(image, image_data, width * height, NULL);
    
    /* Scan for barcodes/QR codes */
    printf("  Scanning for QR codes...\n");
    printf("  Debug: Image format=0x%08x, size=%dx%d, data_size=%d bytes\n", 
           format, width, height, width * height);
    int n = zbar_scan_image(scanner, image);
    printf("  Debug: zbar_scan_image returned %d\n", n);
    if (n < 0) {
        fprintf(stderr, "Error: ZBar scanning failed (return code %d)\n", n);
        goto cleanup;
    }
    
    if (n == 0) {
        fprintf(stderr, "Error: No QR codes found in image\n");
        goto cleanup;
    }
    
    printf("  Found %d symbol(s)\n", n);
    
    /* Extract first symbol (should be QR code) */
    const zbar_symbol_t *symbol = zbar_image_first_symbol(image);
    if (symbol == NULL) {
        fprintf(stderr, "Error: Could not retrieve symbol data\n");
        goto cleanup;
    }
    
    /* Get decoded data */
    const char *data = zbar_symbol_get_data(symbol);
    if (data == NULL) {
        fprintf(stderr, "Error: Symbol data is empty\n");
        goto cleanup;
    }
    
    /* Copy decoded text */
    *decoded_text = strdup(data);
    if (*decoded_text == NULL) {
        fprintf(stderr, "Error: Memory allocation failed\n");
        goto cleanup;
    }
    
    printf("  Decoded %zu bytes\n", strlen(*decoded_text));
    ret = 0;
    
cleanup:
    if (image) {
        zbar_image_destroy(image);
    }
    if (scanner) {
        zbar_image_scanner_destroy(scanner);
    }
    if (image_data) {
        free(image_data);
    }
    
    return ret;
}
