/**
 * Copyright (c) Ronan Le Meillat - SCTG Development 2008-2026
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

/**
 * Represents the location of a client.
 * @typedef {Object} ClientLocation
 * @property {string | null} city - The city of the client. Can be null if not available.
 * @property {string | null} country - The country of the client. Can be null if not available.
 */
export type ClientLocation = {
    city: string | null;
    country: string | null;
};

/**
 * Represents the properties of a files metric event.
 * @typedef {Object} FilesMetricEventProperties
 * @property {string} language - The language of the client.
 * @property {string} username - The username of the client.
 * @property {string | null} user_public_key - The public key of the user. Can be null if not available.
 * @property {Array<{ file: string; virtual_path: string; crypted_path: string }>} files - An array of files with their paths.
 * @property {number} file_count - The number of files.
 * @property {string | null} client_real_ip - The real IP address of the client. Can be null if not available.
 * @property {ClientLocation | null} client_location - The location of the client. Can be null if not available.
 */
export type FilesMetricEventProperties = {
    language: string;
    username: string;
    user_public_key: string | null;
    files: Array<{ file: string; virtual_path: string; crypted_path: string }>;
    file_count: number;
    client_real_ip: string | null;
    client_location: ClientLocation | null;
};

/**
 * Represents the properties of a file metric event.
 * @typedef {Object} FileMetricEventProperties
 * @property {string} language - The language of the client.
 * @property {string} username - The username of the client.
 * @property {string | null} user_public_key - The public key of the user. Can be null if not available.
 * @property {string} file - The name of the file.
 * @property {string} virtual_path - The virtual path of the file.
 * @property {string} crypted_path - The crypted path of the file.
 * @property {string | null} client_real_ip - The real IP address of the client. Can be null if not available.
 * @property {ClientLocation | null} client_location - The location of the client. Can be null if not available.
 */
export type FileMetricEventProperties = {
    language: string;
    username: string;
    user_public_key: string | null;
    file: string;
    virtual_path: string;
    crypted_path: string;
    client_real_ip: string | null;
    client_location: ClientLocation | null;
};