
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
            case 0x09:  // positions
                if (format.componentCount == 0) // xy
                    return 2;
                else if (format.componentCount == 1) // xyz
                    return 3;
                break;
            case 0x0A: // normals
                    return 3;
                break;
            case 0x0B: // color0
            case 0x0C: // color1
                if (format.componentCount == 0) // rgb
                    return 3;
                else if (format.componentCount == 1) // rgba
                    return 4;
                break;
            case 0x0D: // tex coords
            case 0x0E:
            case 0x0F:
            case 0x10:
            case 0x11:
            case 0x12:
            case 0x13:
            case 0x14:
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
    vtx1.arrayFormats = [];
    vtx1.offsets.forEach(function(offset) {
        if (offset == 0)
            return;

        var format = parseArrayFormat(stream, offset);
        vtx1.arrayFormats.push(format);
    });

    function readArray(stream, format, length) {
        length /= format.dataTypeSize;
        var data = new Float32Array(length);
        switch (format.dataType) {
            case 3: // s16 fixed point
                for (var i = 0; i < length; i++)
                    data[i] = readSWord(stream) * format.scale;
                break;
            case 4: // f32
                for (var i = 0; i < length; i++)
                    data[i] = readFloat(stream);
                break;
            case 5: // rgb(a)
                for (var i = 0; i < length; i++)
                    data[i] = readByte(stream) / 255;
                break;
        }

        return data;
    }

    vtx1.arrays = {};

    for (var i = 0, j = 0; i < 13; i++) {
        if (vtx1.offsets[i] == 0)
            continue;

        var length = getSectionLength(vtx1, i);
        var format = vtx1.arrayFormats[j];

        var itemSize, arr;
        var arr = {};

        stream.pos = format.globalOffset;
        arr.data = readArray(stream, format, length);
        arr.itemSize = format.itemSize;
        vtx1.arrays[format.attrib] = arr;

        j++;
    }

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
    drw1.data = collect(stream, readByte, drw1.count);
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
        var frame = {};

        stream.pos += 4; // unk, pad

        var sx = readFloat(stream);
        var sy = readFloat(stream);
        var sz = readFloat(stream);

        var frame = mat4.create();

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

        stream.pos += 2; // unk2

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

    var attribNames = {
        0x09: "position",
        0x0A: "normal",
        0x0B: "color0",
        0x0C: "color1",
        0x0D: "texCoords0",
        0x0E: "texCoords1",
        0x0F: "texCoords2",
        0x10: "texCoords3",
        0x11: "texCoords4",
        0x12: "texCoords5",
        0x13: "texCoords6",
        0x14: "texCoords7",
    };

    var drawTypes = {
        0x98: "strip",
        0xA0: "fan"
    };

    function parseAttribs(stream) {
        var attribs = [];
        var attribOffs = {};
        var itemSize = 0;
        var byteSize = 0;

        do {
            var attrib = {};

            attrib.attrib = readLong(stream);
            attrib.dataType = readLong(stream);

            if (attrib.attrib == 0xFF)
                break;

            if (attrib.dataType == 1)
                byteSize += 1;
            else if (attrib.dataType == 3)
                byteSize += 2;
            else
                console.warn("Unknown attrib data type", attrib.dataType);

            attribOffs[attribNames[attrib.attrib]] = itemSize;
            itemSize += bmd.vtx1.arrays[attrib.attrib].itemSize;
            attribs.push(attrib);
        } while(true);

        attribs.attribOffs = attribOffs;
        attribs.byteSize = byteSize;
        attribs.itemSize = itemSize;
        return attribs;
    }

    function parsePacketLocation(stream) {
        var loc = {};
        loc.size = readLong(stream);
        loc.offset = readLong(stream);
        return loc;
    }

    function copyItem(dst, dstOffs, src, srcIdx) {
        var size = src.itemSize, n = size;
        var srcOffs = srcIdx * size;
        while (n--)
            dst[dstOffs++] = src.data[srcOffs++];
        return size;
    }

    function parsePrimitive(stream, batch, start, count) {
        var dstOffs = start * batch.itemSize;
        for (var i = 0; i < count; i++) {
            batch.attribs.forEach(function(attrib) {
                var idx;
                var src = bmd.vtx1.arrays[attrib.attrib];

                switch (attrib.dataType) {
                    case 1:
                        idx = readByte(stream);
                        break;
                    case 3:
                        idx = readWord(stream);
                        break;
                }

                dstOffs += copyItem(batch.verts, dstOffs, src, idx);
            });
        }
    }

    function parsePacket(stream, batch, loc, start, idx) {
        stream.pos = shp1.offset + shp1.offsetToData + loc.offset;
        var end = stream.pos + loc.size;

        var i = start;
        var primitives = [];
        while (stream.pos < end) {
            var type = readByte(stream);
            if (type == 0)
                break;

            var count = readWord(stream);
            parsePrimitive(stream, batch, i, count);

            var drawType = drawTypes[type];

            var prim = { drawType: drawType,
                         start: i,
                         count: count };
            primitives.push(prim);

            i += count;
        }

        stream.pos = shp1.offset + shp1.offsetToMatrixData + (batch.firstMatrixData + idx) * 8;
        stream.pos += 2; // unk
        var matrixCount = readWord(stream);
        var firstMatrixIndex = readWord(stream);

        stream.pos = shp1.offset + shp1.offsetToMatrixTable + (firstMatrixIndex + idx) * 2;
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
        batch.attribNames = {};
        batch.attribSizes = {};
        batch.attribs.forEach(function(attrib) {
            var name = attribNames[attrib.attrib];
            batch.attribNames[name] = true;
            batch.attribSizes[name] = bmd.vtx1.arrays[attrib.attrib].itemSize;
        });
        batch.attribOffs = batch.attribs.attribOffs;
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

function parseDummy(bmd, stream, offset, size) {
    return { offset: offset, size: size };
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
        var color = {};
        color.r = readByte(stream) / 255;
        color.g = readByte(stream) / 255;
        color.b = readByte(stream) / 255;
        color.a = readByte(stream) / 255;
        return color;
    }

    function parseColorShort(stream) {
        var color = {};
        color.r = readSWord(stream) / 255;
        color.g = readSWord(stream) / 255;
        color.b = readSWord(stream) / 255;
        color.a = readSWord(stream) / 255;
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

    function parseMatEntry(stream) {
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
        zmode.zFunz = readByte(stream);
        zmode.enableUpdate = !!readByte(stream);
        stream.pos += 1; // pad
        return zmode;
    }

    mat3.zModes = readSection(stream, 26, parseZMode, 4);

    return mat3;
}

function parseTEX1(bmd, stream, offset, size) {
    return parseDummy(bmd, stream, offset, size);
}

function parseBMD(stream) {
	stream.pos = 0x20; // skip header

    function parseEntry(tag, func) {
        var offset = stream.pos;
        var readTag = readString(stream, 4);
        if (tag != readTag)
            throw new Error("Bad data: got " + readTag + " for " + tag);
        var size = readLong(stream);

        var entry = func(bmd, stream, offset, size);
        stream.pos = offset + size;
        return entry;
    }

    var bmd = {};
    bmd.inf1 = parseEntry("INF1", parseINF1);
    bmd.vtx1 = parseEntry("VTX1", parseVTX1);
    bmd.evp1 = parseEntry("EVP1", parseEVP1);
    bmd.drw1 = parseEntry("DRW1", parseDRW1);
    bmd.jnt1 = parseEntry("JNT1", parseJNT1);
    bmd.shp1 = parseEntry("SHP1", parseSHP1);
    bmd.mat3 = parseEntry("MAT3", parseMAT3);
    bmd.tex1 = parseEntry("TEX1", parseTEX1);

    // Try and trash the giant arrays that aren't needed anymore.
    delete bmd.vtx1;

    return bmd;
}

function loadModel(filename, callback) {
    var req = fetch(filename);
    req.onload = function(trackerFile) {
        var bmd = parseBMD(makeStream(req.response));
        callback(bmd);
    };
}
