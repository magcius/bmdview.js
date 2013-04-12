
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

function parseVTX1(bmd, stream, offset, size) {
    var vtx1 = { offset: offset, size: size };
    vtx1.arrayFormatOffset = readLong(stream);
    vtx1.offsets = collect(stream, readLong, 13);
    var numArrays = 0;
    vtx1.offsets.forEach(function(x) {
        if (x != 0)
            numArrays++;
    });

    function parseArrayFormat() {
        var format = {};
        format.arrayType = readLong(stream);
        format.componentCount = readLong(stream);

        format.dataType = readLong(stream);
        format.decimalPoint = readByte(stream);
        format.unk3 = readByte(stream);
        format.unk4 = readWord(stream);
        return format;
    }

    stream.pos = vtx1.offset + vtx1.arrayFormatOffset;
    vtx1.arrayFormats = collect(stream, parseArrayFormat, numArrays);

    function getLength(start) {
        var offs = vtx1.offsets[start];
        for (var i = start + 1; i < 13; i++) {
            if (vtx1.offsets[i] != 0)
                return vtx1.offsets[i] - offs;
        }
        return vtx1.size - offs;
    }

    function roundLength(v, x) {
        return v + (x - (v % x));
    }

    function readArray(stream, format, length, itemSize) {
        var data;
        switch (format.dataType) {
            case 3: // s16 fixed point
                var scale = Math.pow(0.5, format.decimalPoint);
                length /= 2;
                data = new Float32Array(roundLength(length, itemSize));
                for (var i = 0; i < length; i++)
                    data[i] = readSWord(stream) * scale;
                break;
            case 4: // f32
                length /= 4;
                data = new Float32Array(roundLength(length, itemSize));
                for (var i = 0; i < length; i++)
                    data[i] = readFloat(stream);
                break;
            case 5: // rgb(a)
                data = new Float32Array(roundLength(length, itemSize));
                for (var i = 0; i < length; i++)
                    data[i] = readByte(stream) / 255;
                break;
        }

        stream.pos += length;
        return { data: data, itemSize: itemSize };
    }

    vtx1.arrays = {};

    function roundLength(v, x) {
        return v + (x - (v % x));
    }

    for (var i = 0, j = 0; i < 13; i++) {
        if (vtx1.offsets[i] == 0)
            continue;

        var length = getLength(i);
        var format = vtx1.arrayFormats[j];

        var itemSize, arr;
        switch (format.arrayType) {
            case 0x09:  // positions
                if (format.componentCount == 0) // xy
                    itemSize = 2;
                else if (format.componentCount == 1) // xyz
                    itemSize = 3;
                break;
            case 0x0A: // normals
                    itemSize = 3;
                break;
            case 0x0B: // color0
            case 0x0C: // color1
                if (format.componentCount == 0) // rgb
                    itemSize = 3;
                else if (format.componentCount == 1) // rgba
                    itemSize = 4;
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
                    itemSize = 1;
                else if (format.componentCount == 1) // st
                    itemSize = 2;
                break;
        }

        stream.pos = vtx1.offset + vtx1.offsets[i];
        vtx1.arrays[format.arrayType] = readArray(stream, format, length, itemSize);

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
    return parseDummy(bmd, stream, offset, size);
}

function parseTEX1(bmd, stream, offset, size) {
    return parseDummy(bmd, stream, offset, size);
}

function parseBMD(stream) {
	stream.pos = 0x20; // skip header

    var parseFuncs = {
        'INF1': parseINF1,
        'VTX1': parseVTX1,
        'EVP1': parseEVP1,
        'DRW1': parseDRW1,
        'JNT1': parseJNT1,
        'SHP1': parseSHP1,
        'MAT3': parseMAT3,
        'TEX1': parseTEX1,
    };

    function parseEntry(bmd) {
        var offset = stream.pos;
        var tag = readString(stream, 4);
        var size = readLong(stream);

        var func = parseFuncs[tag];
        if (!func)
            throw new Error("Unknown tag: " + tag);
        var entry = func(bmd, stream, offset, size);
        bmd[tag.toLowerCase()] = entry;
        return entry;
    }

    var bmd = {};
    while (!eof(stream)) {
        var entry = parseEntry(bmd);
        stream.pos = entry.offset + entry.size;
    }

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
