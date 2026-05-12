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
 * Represents an individual file entry in a batch metric event.
 */
export type FileItem = {
    file: string;
    virtual_path: string;
    crypted_path: string;
};

/**
 * Shared PostHog metric event properties describing user and client context.
 */
export type BaseMetricEventProperties = {
    language: string;
    username: string;
    user_public_key: string | null;
    client_real_ip: string | null;
    client_location: ClientLocation | null;
};

/**
 * Represents the properties of a files metric event.
 */
export type FilesMetricEventProperties = BaseMetricEventProperties & {
    files: Array<FileItem>;
    file_count: number;
};

/**
 * Represents the properties of a file metric event.
 */
export type FileMetricEventProperties = BaseMetricEventProperties & {
    file: string;
    virtual_path: string;
    crypted_path: string;
    from_cache: boolean;
};
