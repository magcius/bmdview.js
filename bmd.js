(function(exports) {
    "use strict";

    function makeStream(buffer) {
        var stream = new DataView(buffer);
        stream.length = buffer.byteLength;
        stream.pos = 0;
        return stream;
    }

    function eof(stream) {
        return stream.pos >= stream.length;
    }

    function readByte(stream) {
        return stream.getUint8(stream.pos++);
    }

    function readWord(stream) {
        return stream.getUint16((stream.pos += 2) - 2);
    }

    function readLong(stream) {
        return stream.getUint32((stream.pos += 4) - 4);
    }

    function readFloat(stream) {
        return stream.getFloat32((stream.pos += 4) - 4);
    }

    function readSWord(stream) {
        return stream.getInt16((stream.pos += 2) - 2);
    }

    function readSByte(stream) {
        return stream.getInt8(stream.pos++);
    }

    function collect(stream, f, length) {
        var B = [];
        for (var i = 0; i < length; i++)
            B.push(f(stream, i));
        return B;
    }

    function readString(stream, length) {
        var B = collect(stream, readByte, length);
        return B.map(function(c) {
            return String.fromCharCode(c);
        }).join('');
    }

    function read0String(stream) {
        var S = "";
        while (true) {
            var c = readByte(stream);
            if (c == 0)
                break;
            S += String.fromCharCode(c);
        }
        return S;
    }

    function fetch(path) {
        var request = new XMLHttpRequest();
        request.open("GET", path, true);
        request.responseType = "arraybuffer";
        request.send();
        return request;
    }

    function parseINF1(bmd, stream, offset, size) {
        var inf1 = { offset: offset, size: size };
        // tag/size already read
        inf1.unk1 = readWord(stream);
        inf1.pad = readWord(stream);
        inf1.unk2 = readLong(stream);
        inf1.vertexCount = readLong(stream);
        inf1.offsetToEntries = readLong(stream);

        function parseINF1Entry() {
            var entry = {};
            entry.type = readWord(stream);
            entry.index = readWord(stream);
            return entry;
        }

        inf1.entries = [];
        stream.pos = inf1.offset + inf1.offsetToEntries;

        while (true) {
            var entry = parseINF1Entry();
            if (entry.type == 0)
                break;
            inf1.entries.push(entry);
        }

        return inf1;
    }

    function getSectionLength(entry, start) {
        var offs = entry.offsets[start];
        for (var i = start + 1; i < 13; i++) {
            if (entry.offsets[i] != 0)
                return entry.offsets[i] - offs;
        }
        return entry.size - offs;
    }

    function parseVTX1(bmd, stream, offset, size) {
        var vtx1 = { offset: offset, size: size };
        vtx1.arrayFormatOffset = readLong(stream);
        vtx1.offsets = collect(stream, readLong, 13);

        function getItemSize(format) {
            switch (format.attrib) {
                case gx.VertexAttribute.POS:
                    if (format.componentCount == 0) // xy
                        return 2;
                    else if (format.componentCount == 1) // xyz
                        return 3;
                    break;
                case gx.VertexAttribute.NRM:
                        return 3;
                    break;
                case gx.VertexAttribute.CLR0:
                case gx.VertexAttribute.CLR1:
                    if (format.componentCount == 0) // rgb
                        return 3;
                    else if (format.componentCount == 1) // rgba
                        return 4;
                    break;
                case gx.VertexAttribute.TEX0:
                case gx.VertexAttribute.TEX1:
                case gx.VertexAttribute.TEX2:
                case gx.VertexAttribute.TEX3:
                case gx.VertexAttribute.TEX4:
                case gx.VertexAttribute.TEX5:
                case gx.VertexAttribute.TEX6:
                case gx.VertexAttribute.TEX7:
                    if (format.componentCount == 0) // s
                        return 1;
                    else if (format.componentCount == 1) // st
                        return 2;
                    break;
            }
        }

        function getDataTypeSize(format) {
            switch (format.dataType) {
                case 3: // s16 fixed point
                    return 2;
                case 4: // f32
                    return 4;
                case 5: // rgba
                    return 1;
            }
        }

        function parseArrayFormat(stream, offset) {
            var format = {};

            format.attrib = readLong(stream);
            format.componentCount = readLong(stream);
            format.dataType = readLong(stream);
            format.decimalPoint = readByte(stream);
            stream.pos += 3; // unk

            format.globalOffset = vtx1.offset + offset;
            format.scale = Math.pow(0.5, format.decimalPoint);
            format.itemSize = getItemSize(format);
            format.dataTypeSize = getDataTypeSize(format);

            return format;
        }

        stream.pos = vtx1.offset + vtx1.arrayFormatOffset;
        vtx1.formats = {};
        vtx1.offsets.forEach(function(offset, i) {
            if (offset == 0)
                return;

            var format = parseArrayFormat(stream, offset);
            vtx1.formats[format.attrib] = format;

            format.sectionLength = getSectionLength(vtx1, i);
        });

        return vtx1;
    }

    function parseEVP1(bmd, stream, offset, size) {
        var evp1 = { offset: offset, size: size };
        evp1.count = readWord(stream);
        evp1.pad = readWord(stream);

        evp1.countsOffset = readLong(stream);
        evp1.indexesOffset = readLong(stream);
        evp1.weightsOffset = readLong(stream);
        evp1.matricesOffset = readLong(stream);

        stream.pos = evp1.offset + evp1.countsOffset;
        evp1.counts = collect(stream, readByte, evp1.count);

        evp1.indexes = [];
        for (var i = 0; i < evp1.count; i++)
            evp1.indexes.push(collect(stream, readWord, evp1.counts[i]));

        evp1.weights = [];
        for (var i = 0; i < evp1.count; i++)
            evp1.weights.push(collect(stream, readFloat, evp1.counts[i]));

        function readMatrix(stream) {
            function readMatrixRow(stream) {
                return collect(stream, readFloat, 4);
            }
            return collect(stream, readMatrixRow, 3);
        }

        evp1.matrices = [];
        for (var i = 0; i < evp1.count; i++)
            evp1.matrices.push(collect(stream, readMatrix, evp1.counts[i]));

        return evp1;
    }

    function parseStringTable(stream) {
        var tableOffset = stream.pos;

        var count = readWord(stream);
        stream.pos += 2; // pad

        function readOffset(stream) {
            stream.pos += 2; // unk
            return readSWord(stream);
        }

        var offsets = collect(stream, readOffset, count);
        var strings = offsets.map(function(offs) {
            stream.pos = tableOffset + offs;
            return read0String(stream);
        });
        return strings;
    }

    function parseDRW1(bmd, stream, offset, size) {
        var drw1 = { offset: offset, size: size };
        drw1.count = readWord(stream);
        drw1.pad = readWord(stream);
        drw1.offsetToIsWeighted = readLong(stream);
        drw1.offsetToData = readLong(stream);

        stream.pos = drw1.offset + drw1.offsetToIsWeighted;
        drw1.isWeighted = collect(stream, readByte, drw1.count);

        stream.pos = drw1.offset + drw1.offsetToData;
        drw1.data = collect(stream, readWord, drw1.count);
        return drw1;
    }

    function parseJNT1(bmd, stream, offset, size) {
        var jnt1 = { offset: offset, size: size };
        jnt1.count = readWord(stream);
        jnt1.pad = readWord(stream);
        jnt1.offsetToEntries = readLong(stream);
        jnt1.offsetToUnk = readLong(stream);
        jnt1.offsetToStringTable = readLong(stream);

        stream.pos = jnt1.offset + jnt1.offsetToStringTable;
        var table = parseStringTable(stream);
        if (table.length != jnt1.count)
            throw new Error("bad data");

        function readFrame(stream, i) {
            var frame = mat4.create();

            stream.pos += 4; // unk, pad

            var sx = readFloat(stream);
            var sy = readFloat(stream);
            var sz = readFloat(stream);

            var rx = readSWord(stream) / 32768 * Math.PI;
            var ry = readSWord(stream) / 32768 * Math.PI;
            var rz = readSWord(stream) / 32768 * Math.PI;

            stream.pos += 2; // pad

            var tx = readFloat(stream);
            var ty = readFloat(stream);
            var tz = readFloat(stream);
            mat4.translate(frame, frame, [tx, ty, tz]);
            mat4.rotateX(frame, frame, rx);
            mat4.rotateY(frame, frame, ry);
            mat4.rotateZ(frame, frame, rz);

            stream.pos += 4; // unk2

            frame.bbMin = collect(stream, readFloat, 3);
            frame.bbMax = collect(stream, readFloat, 3);

            frame.name = table[i];
            return frame;
        }

        stream.pos = jnt1.offset + jnt1.offsetToEntries;
        jnt1.frames = collect(stream, readFrame, jnt1.count);
        return jnt1;
    }

    function parseSHP1(bmd, stream, offset, size) {
        var shp1 = { offset: offset, size: size };
        shp1.batchCount = readWord(stream);
        shp1.pad = readWord(stream);
        shp1.offsetToBatches = readLong(stream);
        shp1.offsetToUnk = readLong(stream);
        stream.pos += 4; // 0
        shp1.offsetToBatchAttribs = readLong(stream);
        shp1.offsetToMatrixTable = readLong(stream);

        shp1.offsetToData = readLong(stream);
        shp1.offsetToMatrixData = readLong(stream);
        shp1.offsetToPacketLocations = readLong(stream);

        function parseBatch(stream, idx) {
            var batch = {};
            batch.idx = idx;
            batch.matrixType = readByte(stream);
            batch.unk2 = readByte(stream);
            batch.packetCount = readWord(stream);
            batch.offsetToAttribs = readWord(stream);
            batch.firstMatrixData = readWord(stream);
            batch.firstPacketLocation = readWord(stream);
            batch.unk3 = readWord(stream);
            batch.unk4 = readFloat(stream);
            batch.bbMin = collect(stream, readFloat, 3);
            batch.bbMax = collect(stream, readFloat, 3);
            return batch;
        }

        stream.pos = shp1.offset + shp1.offsetToBatches;
        shp1.batches = collect(stream, parseBatch, shp1.batchCount);

        function parseAttribs(stream) {
            var attribs = [];
            var offs = 0;
            var byteSize = 0;

            do {
                var attrib = {};

                attrib.type = readLong(stream);
                attrib.dataType = readLong(stream);

                if (attrib.type == 0xFF)
                    break;

                if (attrib.dataType == 1)
                    byteSize += 1;
                else if (attrib.dataType == 3)
                    byteSize += 2;
                else
                    console.warn("Unknown attrib data type", attrib.dataType);

                var size = bmd.vtx1.formats[attrib.type].itemSize;
                attrib.size = size;
                attrib.offset = offs;

                offs += size;

                attribs.push(attrib);
            } while(true);

            attribs.byteSize = byteSize;
            attribs.itemSize = offs;
            return attribs;
        }

        function parsePacketLocation(stream) {
            var loc = {};
            loc.size = readLong(stream);
            loc.offset = readLong(stream);
            return loc;
        }

        function parsePrimitive(stream, batch, start, count) {
            var dstOffs = start * batch.itemSize;
            for (var i = 0; i < count; i++) {
                batch.attribs.forEach(function(attrib) {
                    var format = bmd.vtx1.formats[attrib.type];
                    var size = format.itemSize;
                    var idx;

                    switch (attrib.dataType) {
                        case 1:
                            idx = readByte(stream);
                            break;
                        case 3:
                            idx = readWord(stream);
                            break;
                    }

                    var savedPos = stream.pos;
                    stream.pos = format.globalOffset + (idx * size * format.dataTypeSize);
                    switch (format.dataType) {
                        case 3: // s16 fixed point
                            for (var i = 0; i < size; i++)
                                batch.verts[dstOffs++] = readSWord(stream) * format.scale;
                            break;
                        case 4: // f32
                            for (var i = 0; i < size; i++)
                                batch.verts[dstOffs++] = readFloat(stream);
                            break;
                        case 5: // rgb(a)
                            for (var i = 0; i < size; i++)
                                batch.verts[dstOffs++] = readByte(stream) / 255;
                            break;
                    }
                    stream.pos = savedPos;
                });
            }
        }

        function parsePacket(stream, batch, loc, start, idx) {
            stream.pos = shp1.offset + shp1.offsetToData + loc.offset;
            var end = stream.pos + loc.size;

            var i = start;
            var primitives = [];
            while (stream.pos < end) {
                var drawType = readByte(stream);
                if (drawType == 0)
                    break;

                var count = readWord(stream);
                parsePrimitive(stream, batch, i, count);

                var prim = { drawType: drawType,
                             start: i,
                             count: count };
                primitives.push(prim);

                i += count;
            }

            stream.pos = shp1.offset + shp1.offsetToMatrixData + (batch.firstMatrixData + idx) * 8;
            stream.pos += 2; // unk
            var matrixCount = readWord(stream);
            var firstMatrixIndex = readLong(stream);

            stream.pos = shp1.offset + shp1.offsetToMatrixTable + firstMatrixIndex*2;
            var matrixIndexes = collect(stream, readWord, matrixCount);
            var matrixTable = matrixIndexes.map(function(index) {
                // Special code to keep last matrix when updating the tables.
                if (index == 0xFFFF)
                    return -1;

                if (bmd.drw1.isWeighted[index])
                    console.warn("Matrix weights are unsupported");

                // XXX -- handle weights. Should be in here or in the shader?
                return bmd.drw1.data[index];
            });

            var packet = { matrixTable: matrixTable,
                           primitives: primitives };
            batch.packets.push(packet);
            return i;
        }

        function countPacket(stream, batch, loc, start) {
            stream.pos = shp1.offset + shp1.offsetToData + loc.offset;
            var end = stream.pos + loc.size;

            var i = start;
            while (stream.pos < end) {
                var type = readByte(stream);
                if (type == 0)
                    break;
                var count = readWord(stream);
                i += count;
                stream.pos += batch.byteSize * count;
            }
            return i;
        }

        function parseBatchData(batch) {
            // parse attribs
            stream.pos = shp1.offset + shp1.offsetToBatchAttribs + batch.offsetToAttribs;
            batch.attribs = parseAttribs(stream);
            batch.itemSize = batch.attribs.itemSize;
            batch.byteSize = batch.attribs.byteSize;

            // count verts
            stream.pos = shp1.offset + shp1.offsetToPacketLocations + (batch.firstPacketLocation * 8);
            var locations = collect(stream, parsePacketLocation, batch.packetCount);
            var vertCount = 0;
            locations.forEach(function(loc) {
                vertCount = countPacket(stream, batch, loc, vertCount);
            });
            batch.vertCount = vertCount;

            // alloc verts storage
            batch.verts = new Float32Array(batch.vertCount * batch.itemSize);

            // parse vertex data
            vertCount = 0;
            batch.packets = [];
            locations.forEach(function(loc, i) {
                vertCount = parsePacket(stream, batch, loc, vertCount, i);
            });
        }

        shp1.batches.forEach(parseBatchData);

        return shp1;
    }

    function parseMAT3(bmd, stream, offset, size) {
        var mat3 = { offset: offset, size: size };
        mat3.count = readWord(stream);
        stream.pos += 2; // pad
        mat3.offsets = collect(stream, readLong, 30);

        stream.pos = mat3.offset + mat3.offsets[2];
        mat3.nameTable = parseStringTable(stream);

        stream.pos = mat3.offset + mat3.offsets[1];
        mat3.indexToMatIndex = collect(stream, readWord, mat3.count);
        var maxIndex = Math.max.apply(null, mat3.indexToMatIndex);

        function parseColor(stream) {
            var color = [];
            color.push(readByte(stream) / 255);
            color.push(readByte(stream) / 255);
            color.push(readByte(stream) / 255);
            color.push(readByte(stream) / 255);
            return color;
        }

        function parseColorShort(stream) {
            var color = [];
            color.push(readSWord(stream) / 255);
            color.push(readSWord(stream) / 255);
            color.push(readSWord(stream) / 255);
            color.push(readSWord(stream) / 255);
            return color;
        }

        function readSection(stream, offset, func, itemSize) {
            stream.pos = mat3.offset + mat3.offsets[offset];
            return collect(stream, func, getSectionLength(mat3, offset) / itemSize);
        }

        mat3.color1 = readSection(stream, 5, parseColor, 4);
        mat3.color2 = readSection(stream, 8, parseColor, 4);
        mat3.color3 = readSection(stream, 18, parseColor, 4);
        mat3.colorS10 = readSection(stream, 17, parseColorShort, 8);

        function parseMatEntry(stream, i) {
            var entry = {};
            entry.flag = readByte(stream);
            entry.cullIndex = readByte(stream);
            entry.numChansIndex = readByte(stream);
            entry.texGenCountIndex = readByte(stream);
            entry.tevCountIndex = readByte(stream);
            stream.pos += 1; // unk
            entry.zModeIndex = readByte(stream);
            stream.pos += 1; // unk
            entry.color1 = collect(stream, readWord, 2);
            entry.chanControls = collect(stream, readWord, 4);
            entry.color2 = collect(stream, readWord, 2);
            entry.lights = collect(stream, readWord, 8);
            entry.texGenInfo = collect(stream, readWord, 8);
            entry.texGenInfo2 = collect(stream, readWord, 8);
            entry.texMatrices = collect(stream, readWord, 10);
            entry.dttMatrices = collect(stream, readWord, 20);
            entry.texStages = collect(stream, readWord, 8);
            entry.color3 = collect(stream, readWord, 4);
            entry.constColorSel = collect(stream, readByte, 16);
            entry.constAlphaSel = collect(stream, readByte, 16);
            entry.tevOrderInfo = collect(stream, readWord, 16);
            entry.colorS10 = collect(stream, readWord, 4);
            entry.tevStageInfo = collect(stream, readWord, 16);
            entry.tevSwapModeInfo = collect(stream, readWord, 16);
            entry.tevSwapModeTable = collect(stream, readWord, 4);
            stream.pos += 24; // unk
            stream.pos += 2; // unk
            entry.alphaCompIndex = readWord(stream);
            entry.blendIndex = readWord(stream);
            stream.pos += 2;

            entry.index = i;
            return entry;
        }

        stream.pos = mat3.offset + mat3.offsets[0];
        mat3.materials = collect(stream, parseMatEntry, maxIndex + 1);

        function parseTexMtxInfo(stream) {
            var texMtxInfo = {};
            stream.pos += 4; // unk, pad
            texMtxInfo.f1 = collect(stream, readFloat, 5);
            stream.pos += 4; // unk, pad
            texMtxInfo.f2 = collect(stream, readFloat, 2);
            texMtxInfo.f3 = collect(stream, readFloat, 16);
            return texMtxInfo;
        }

        mat3.cullModes = readSection(stream, 4, readLong, 4);

        mat3.texMtxInfos = readSection(stream, 13, parseTexMtxInfo, 100);
        mat3.texStageIndexToTextureIndex = readSection(stream, 15, readWord, 2);

        function parseTevOrderInfo(stream) {
            var tevOrderInfo = {};
            tevOrderInfo.texCoordId = readByte(stream);
            tevOrderInfo.texMap = readByte(stream);
            tevOrderInfo.chanId = readByte(stream);
            stream.pos += 1; // pad
            return tevOrderInfo;
        }

        mat3.tevOrderInfos = readSection(stream, 16, parseTevOrderInfo, 4);

        mat3.tevCounts = readSection(stream, 19, readByte, 1);

        function parseTevStageInfo(stream) {
            var tevStageInfo = {};
            stream.pos += 1; // unk
            tevStageInfo.colorIn = collect(stream, readByte, 4);
            tevStageInfo.colorOp = readByte(stream);
            tevStageInfo.colorBias = readByte(stream);
            tevStageInfo.colorScale = readByte(stream);
            tevStageInfo.colorClamp = readByte(stream);
            tevStageInfo.colorRegId = readByte(stream);
            tevStageInfo.alphaIn = collect(stream, readByte, 4);
            tevStageInfo.alphaOp = readByte(stream);
            tevStageInfo.alphaBias = readByte(stream);
            tevStageInfo.alphaScale = readByte(stream);
            tevStageInfo.alphaClamp = readByte(stream);
            tevStageInfo.alphaRegId = readByte(stream);
            stream.pos += 1; // unk
            return tevStageInfo;
        }

        mat3.tevStageInfos = readSection(stream, 20, parseTevStageInfo, 20);

        function parseTevSwapModeInfo(stream) {
            var tevSwapModeInfo = {};
            tevSwapModeInfo.rasSel = readByte(stream);
            tevSwapModeInfo.texSel = readByte(stream);
            stream.pad += 2;
            return tevSwapModeInfo;
        }

        mat3.tevSwapModeInfos = readSection(stream, 21, parseTevSwapModeInfo, 4);
        mat3.tevSwapModeTables = readSection(stream, 22, parseColor, 4);

        function parseAlphaCompare(stream) {
            var alphaCompare = {};
            alphaCompare.comp0 = readByte(stream);
            alphaCompare.ref0 = readByte(stream);
            alphaCompare.alphaOp = readByte(stream);
            alphaCompare.comp1 = readByte(stream);
            alphaCompare.ref1 = readByte(stream);
            stream.pos += 3; // pad
            return alphaCompare;
        }

        mat3.alphaCompares = readSection(stream, 24, parseAlphaCompare, 4);

        function parseBlendInfo(stream) {
            var blendInfo = {};
            blendInfo.blendMode = readByte(stream);
            blendInfo.srcFactor = readByte(stream);
            blendInfo.dstFactor = readByte(stream);
            blendInfo.logicOp = readByte(stream);
            return blendInfo;
        }

        mat3.blendInfos = readSection(stream, 25, parseBlendInfo, 4);

        function parseZMode(stream) {
            var zmode = {};
            zmode.enable = !!readByte(stream);
            zmode.zFunc = readByte(stream);
            zmode.enableUpdate = !!readByte(stream);
            stream.pos += 1; // pad
            return zmode;
        }

        mat3.zModes = readSection(stream, 26, parseZMode, 4);

        return mat3;
    }

    function parseTEX1(bmd, stream, offset, size) {
        var tex1 = { offset: offset, size: size };

        function parseTextureHeader(stream, i) {
            var texture = {};
            texture.format = readByte(stream);
            stream.pos += 1; // unk
            texture.width = readWord(stream);
            texture.height = readWord(stream);
            texture.wrapS = readByte(stream);
            texture.wrapT = readByte(stream);
            stream.pos += 1; // unk
            texture.paletteFormat = readByte(stream);
            texture.paletteNumEntries = readWord(stream);
            texture.paletteOffset = readLong(stream);
            stream.pos += 4; // unk
            texture.minFilter = readByte(stream);
            texture.magFilter = readByte(stream);
            stream.pos += 2; // unk
            texture.mipmapCount = readByte(stream);
            stream.pos += 3; // unk
            texture.dataOffset = readLong(stream);

            texture.baseOffset = tex1.offset + tex1.textureHeaderOffset + 0x20*i;
            texture.name = tex1.nameTable[i];
            return texture;
        }

        tex1.count = readWord(stream);
        stream.pos += 2; // unk
        tex1.textureHeaderOffset = readLong(stream);
        tex1.stringTableOffset = readLong(stream);

        stream.pos = tex1.offset + tex1.stringTableOffset;
        tex1.nameTable = parseStringTable(stream);

        stream.pos = tex1.offset + tex1.textureHeaderOffset;
        var textureHeaders = collect(stream, parseTextureHeader, tex1.count);

        function getCompressedBufferSize(format, w, h) {
            var w8 = (w + 7) & ~7;
            var h8 = (h + 7) & ~7;
            var w4 = (w + 3) & ~3;
            var h4 = (h + 3) & ~3;

            switch(format)  {
                case gx.TexFormat.I4:
                    return w8 * h8 / 2;
                case gx.TexFormat.I8:
                    return w8 * h8;
                case gx.TexFormat.IA4:
                    return w8 * h4;
                case gx.TexFormat.IA8:
                    return w4 * h4 * 2;
                case gx.TexFormat.RGB565:
                    return w4 * h4 * 2;
                case gx.TexFormat.RGB5A3:
                    return w4 * h4 * 2;
                case gx.TexFormat.RGBA8:
                    return w4 * h4 * 4;
                case gx.TexFormat.CI4:
                    return w8 * h8 / 2;
                case gx.TexFormat.CI8:
                    return w8 * h8;
                case gx.TexFormat.CI14:
                    return w8 * h8 * 2;
                case gx.TexFormat.CMPR:
                    return w4 * h4 / 2;
            }
            console.warn("Unknown texture format");
            return -1;
        }

        function getUncompressedBufferFormat(format, paletteFormat) {
            switch (format) {
                case gx.TexFormat.I4:
                case gx.TexFormat.I8:
                    return "i8";
                case gx.TexFormat.IA4:
                case gx.TexFormat.IA8:
                    return "i8_a8";
                case gx.TexFormat.RGB565:
                case gx.TexFormat.RGB5A3:
                case gx.TexFormat.RGBA8:
                    return "rgba8";
                case gx.TexFormat.CI4:
                case gx.TexFormat.CI8:
                case gx.TexFormat.CI14:
                    switch (paletteFormat) {
                        case gx.TexPalete.IA8: // PAL_A8_I8
                            return "i8_a8";
                        case gx.TexPalete.RGB565: // PAL_R5_G6_B5
                        case gx.TexPalete.RGB5A3: // PAL_A3_RGB5
                            return "rgba8";
                    }
                    break;
                case gx.TexFormat.CMPR:
                    return "dxt1";
            }

            return null;
        }

        function getUncompressedBufferSize(format, w, h) {
            switch (format) {
                case "i8":
                    return w * h;
                case "i8_a8":
                    return w * h * 2;
                case "rgba8":
                    return w * h * 4;
                case "dxt1":
                    // Round to the nearest multiple of four.
                    var w4 = (w + 3) & ~3;
                    var h4 = (h + 3) & ~3;
                    return w4 * h4 / 2;
            }

            return null;
        }

        function rgb5a3(dst, dstOffs, pixel) {
            // http://www.mindcontrol.org/~hplus/graphics/expand-bits.html
            var r, g, b, a;
            if ((pixel & 0x8000) == 0x8000) { // RGBA5
                a = 0xff;

                r = (pixel & 0x7c00) >> 10;
                r = (r << (8-5)) | (r >> (10-8));

                g = (pixel & 0x3e0) >> 5;
                g = (g << (8-5)) | (g >> (10-8));

                b = pixel & 0x1f;
                b = (b << (8-5)) | (b >> (10-8));
            } else { //a3rgb4
                a = (pixel & 0x7000) >> 12;
                a = (a << (8-3)) | (a << (8-6)) | (a >> (9-8));

                r = (pixel & 0xf00) >> 8;
                r = (r << (8-4)) | r;

                g = (pixel & 0xf0) >> 4;
                g = (g << (8-4)) | g;

                b = pixel & 0xf;
                b = (b << (8-4)) | b;
            }

            dst[dstOffs+0] = r;
            dst[dstOffs+1] = g;
            dst[dstOffs+2] = b;
            dst[dstOffs+3] = a;
        }

        function readI4(dst, src, w, h) {
            var si = 0;

            for (var y = 0; y < h; y += 8)
                for (var x = 0; x < w; x += 8)
                    for (var dy = 0; dy < 8; dy++)
                        for (var dx = 0; dx < 8; dx += 2) {
                            // http://www.mindcontrol.org/~hplus/graphics/expand-bits.html
                            var t;
                            t = (src[si] & 0xF0);
                            dst[w*(y + dy) + x + dx] = t | (t >> 4);
                            t = (src[si] & 0x0F);
                            dst[w*(y + dy) + x + dx + 1] = (t << 4) | t;
                            ++si;
                        }
        }

        function readI8(dst, src, w, h) {
            var si = 0;

            for (var y = 0; y < h; y += 4)
                for (var x = 0; x < w; x += 8)
                    for (var dy = 0; dy < 4; dy++)
                        for (var dx = 0; dx < 8; dx++, si++)
                            dst[w*(y + dy) + x + dx] = src[si];
        }

        function readIA4(dst, src, w, h) {
            var si = 0;

            for (var y = 0; y < h; y += 8)
                for (var x = 0; x < w; x += 8)
                    for (var dy = 0; dy < 8; dy++)
                        for (var dx = 0; dx < 16; dx += 2, si++) {
                            // http://www.mindcontrol.org/~hplus/graphics/expand-bits.html
                            var t;
                            t = (src[si] & 0x0F);
                            dst[w*(y + dy) + x + dx] = (t << 4) | t;
                            t = (src[si] & 0xF0);
                            dst[w*(y + dy) + x + dx + 1] = t | (t >> 4);
                        }
        }

        function readIA8(dst, src, w, h) {
            console.warn("Unsupported texture: IA8");
        }

        function r5g6b5(dst, dstOffs, pixel) {
            var r, g, b;
            r = (pixel & 0xF100) >> 11;
            g = (pixel & 0x07E0) >> 5;
            b = (pixel & 0x001F);

            // http://www.mindcontrol.org/~hplus/graphics/expand-bits.html
            r = (r << (8 - 5)) | (r >> (10 - 8));
            g = (g << (8 - 6)) | (g >> (12 - 8));
            b = (b << (8 - 5)) | (b >> (10 - 8));

            dst[dstOffs+0] = r;
            dst[dstOffs+1] = g;
            dst[dstOffs+2] = b;
            dst[dstOffs+3] = 0xFF;
        }

        function readRGB565(dst, src, w, h) {
            var si = 0;
            for (var y = 0; y < h; y += 4)
                for (var x = 0; x < w; x += 4)
                    for (var dy = 0; dy < 4; dy++)
                        for (var dx = 0; dx < 4; dx++) {
                            var srcPixel = src[si] << 8 | src[si + 1];
                            var dstOffs = 4*(w*(y + dy) + x + dx);
                            r5g6b5(dst, dstOffs, srcPixel);
                            si += 2;
                        }
        }

        function readRGB5A3(dst, src, w, h) {
            var si = 0;
            for (var y = 0; y < h; y += 4)
                for (var x = 0; x < w; x += 4)
                    for (var dy = 0; dy < 4; dy++)
                        for (var dx = 0; dx < 4; dx++) {
                            var srcPixel = src[si] << 8 | src[si + 1];
                            var dstOffs = 4*(w*(y + dy) + x + dx);
                            rgb5a3(dst, dstOffs, srcPixel);
                            si += 2;
                        }
        }

        function readRGBA8(dst, src, w, h) {
            console.warn("Unsupported texture: ARGB8");
        }

        function readS3TC1(dst, src, w, h) {
            function reverseByte(b) {
                var b1 = b & 0x3;
                var b2 = b & 0xc;
                var b3 = b & 0x30;
                var b4 = b & 0xc0;
                return (b1 << 6) | (b2 << 2) | (b3 >> 2) | (b4 >> 6);
            }

            var si = 0;
            for (var y = 0; y < h / 4; y += 2)
                for (var x = 0; x < w / 4; x += 2)
                    for (var dy = 0; dy < 2; dy++)
                        for (var dx = 0; dx < 2; dx++) {
                            var dstOffs = 8*((y + dy)*w/4 + x + dx);

                            dst[dstOffs+0] = src[si+1];
                            dst[dstOffs+1] = src[si+0];
                            dst[dstOffs+2] = src[si+3];
                            dst[dstOffs+3] = src[si+2];

                            dst[dstOffs+4] = reverseByte(src[si+4]);
                            dst[dstOffs+5] = reverseByte(src[si+5]);
                            dst[dstOffs+6] = reverseByte(src[si+6]);
                            dst[dstOffs+7] = reverseByte(src[si+7]);
                            si += 8;
                        }
        }

        function readImage(dst, src, palette, w, h, format) {
            switch (format) {
                case gx.TexFormat.I4:
                    return readI4(dst, src, w, h);
                case gx.TexFormat.I8:
                    return readI8(dst, src, w, h);
                case gx.TexFormat.IA4:
                    return readIA4(dst, src, w, h);
                case gx.TexFormat.IA8:
                    return readIA8(dst, src, w, h);
                case gx.TexFormat.RGB565:
                    return readRGB565(dst, src, w, h);
                case gx.TexFormat.RGB5A3:
                    return readRGB5A3(dst, src, w, h);
                case gx.TexFormat.RGBA8:
                    return readRGBA8(dst, src, w, h);
                case gx.TexFormat.CMPR:
                    return readS3TC1(dst, src, w, h);
                default:
                    console.warn("Unsupported texture", format);
            }
        }

        function parseTexture(header) {
            // XXX -- what to do?
            if (header.dataFormat == 0)
                return null;

            var palette = null;
            if (header.paletteNumEntries != 0)
                palette = new Uint8Array(stream.buffer, header.baseOffset + header.paletteOffset, header.paletteNumEntries * 2);

            // TODO: mipmaps
            var w = header.width, h = header.height;
            var uncompressedBufferFormat = getUncompressedBufferFormat(header.format, header.paletteFormat);
            if (uncompressedBufferFormat == null)
                return null;

            var uncompressedBufferSize = getUncompressedBufferSize(uncompressedBufferFormat, w, h);
            var dst = new Uint8Array(uncompressedBufferSize);

            var compressedBufferSize = getCompressedBufferSize(header.format, w, h);
            var src = new Uint8Array(stream.buffer, header.baseOffset + header.dataOffset, compressedBufferSize);

            readImage(dst, src, palette, w, h, header.format);

            return { pixels: dst,
                     name: header.name,
                     wrapS: header.wrapS,
                     wrapT: header.wrapT,
                     minFilter: header.minFilter,
                     magFilter: header.magFilter,
                     width: w,
                     height: h,
                     format: uncompressedBufferFormat };
        }

        tex1.textures = textureHeaders.map(parseTexture);

        return tex1;
    }

    function parseBMD(stream) {
        stream.pos = 0x20; // skip header

        var funcs = {
            "INF1": parseINF1,
            "VTX1": parseVTX1,
            "EVP1": parseEVP1,
            "DRW1": parseDRW1,
            "JNT1": parseJNT1,
            "SHP1": parseSHP1,
            "MAT3": parseMAT3,
            "TEX1": parseTEX1,
        };

        function parseEntryHeader() {
            var offset = stream.pos;
            var tag = readString(stream, 4);
            var size = readLong(stream);
            return { tag: tag, size: size, offset: offset };
        }

        var bmd = {};
        function doEntry() {
            var header = parseEntryHeader();
            var func = funcs[header.tag];
            if (func) {
                var entry = func(bmd, stream, header.offset, header.size);
                bmd[header.tag.toLowerCase()] = entry;
            } else {
                console.log("Unrecognized section: ", header.tag);
            }

            stream.pos = header.offset + header.size;
        }

        while (!eof(stream))
            doEntry();

        return bmd;
    }

    function loadModel(filename, callback) {
        var req = fetch(filename);
        req.onload = function(trackerFile) {
            var stream = makeStream(req.response);
            var bmd = parseBMD(stream);
            callback(stream, bmd);
        };
    }

    exports.loadModel = loadModel;

})(window);
