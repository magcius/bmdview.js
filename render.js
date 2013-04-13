
function createScene(gl) {
    var projection = mat4.create();
    mat4.perspective(projection, Math.PI / 4, gl.viewportWidth / gl.viewportHeight, 0.1*128, 2500*128);
 
    var modelView = mat4.create();

    var drawTypes = { "strip": gl.TRIANGLE_STRIP,
                      "fan": gl.TRIANGLE_FAN };

    gl.viewport(0, 0, gl.viewportWidth, gl.viewportHeight);
    gl.clearColor(77/255, 50/255, 153/255, 1);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.frontFace(gl.CW);

    function renderModel(model) {
        var matrices = [];
        var locations;
        for (var i = 0; i < 10; i++)
            matrices.push(mat4.create());

        function command_updateMatrix(command) {
            matrices[command.idx] = command.matrix;
        }

        function command_updateMaterial(command) {
            gl.useProgram(command.program);
            locations = command.program.locations;

            function applyBlendInfo(blendInfo) {
                if (blendInfo.enable) {
                    gl.enable(gl.BLEND);
                    gl.blendFunc(blendInfo.src, blendInfo.dst);
                } else {
                    gl.disable(gl.BLEND);
                }
            }

            function applyCullInfo(cullInfo) {
                if (cullInfo.enable) {
                    gl.enable(gl.CULL_FACE);
                    gl.cullFace(cullInfo.face);
                } else {
                    gl.disable(gl.CULL_FACE);
                }
            }

            function applyDepthTest(depthTest) {
                if (depthTest.enable) {
                    gl.enable(gl.DEPTH_TEST);
                    gl.depthFunc(depthTest.func);
                    gl.depthMask(depthTest.mask);
                } else {
                    gl.disable(gl.DEPTH_TEST);
                }
            }

            applyBlendInfo(command.blendInfo);
            applyCullInfo(command.cullInfo);
            applyDepthTest(command.depthTest);
        }

        function command_draw(command) {
            gl.bindBuffer(gl.ARRAY_BUFFER, command.buffer);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, command.elementBuffer);

            var attribs = command.attribs;
            attribs.forEach(function(attrib) {
                var name = attrib.name;
                if (locations[name] === undefined)
                    return; // TODO: this attribute

                gl.vertexAttribPointer(
                    locations[name],               // location
                    attrib.size,                   // size
                    gl.FLOAT,                      // type
                    false,                         // normalize
                    command.itemSize          * 4, // stride
                    attrib.offset             * 4  // offset
                );
                gl.enableVertexAttribArray(locations[name]);
            });

            var matrixTable = [];
            function updateMatrixTable(packet) {
                var updated = false;
                packet.matrixTable.forEach(function(idx, i) {
                    if (idx == -1)
                        return; // keep old

                    if (matrixTable[i] != matrices[idx]) {
                        matrixTable[i] = matrices[idx];
                        updated = true;
                    }
                });
                return updated;
            }

            gl.uniformMatrix4fv(locations.projection, false, projection);
            gl.uniformMatrix4fv(locations.modelView, false, modelView);

            command.packets.forEach(function(packet) {
                if (updateMatrixTable(packet))
                    gl.uniformMatrix4fv(locations.vertexMatrix, false, matrixTable[0]);

                packet.primitives.forEach(function(prim) {
                    gl.drawElements(
                        drawTypes[prim.drawType], // mode
                        prim.count,               // count
                        gl.UNSIGNED_SHORT,        // type
                        prim.start * 2            // offset
                    );
                });
            });

            attribs.forEach(function(attrib) {
                var name = attrib.name;
                if (locations[name] === undefined)
                    return; // TODO: this attribute

                gl.disableVertexAttribArray(locations[name]);
            });
        }

        var dispatch = {
            "draw": command_draw,
            "updateMaterial": command_updateMaterial,
            "updateMatrix": command_updateMatrix,
        };

        model.commands.forEach(function(command) {
            dispatch[command.type](command);
        });
    }

    var models = [];

    var scene = {};

    function render() {
        gl.depthMask(true);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        models.forEach(renderModel);
    }

    scene.attachModel = function(model) {
        models.push(model);
        render();
    };
    scene.setCamera = function(matrix) {
        mat4.copy(modelView, matrix);
        render();
    };

    return scene;
}

function glslValue(val) {
    if (val.toFixed)
        return val.toFixed(6);
    else
        return "" + val;
}

function glslCall(name, args) {
    return name + "(" + args.map(glslValue).join(", ") + ")";
}

function getKonstIdName(id) {
    return "c_color" + id;
}

function getRegIdName(id) {
    return "r_color" + id;
}

function getTexAccess(info) {
    // XXX
    return "vec4(0.5, 0.5, 0.5, 1.0)";
}

function getRasColor(info) {
    // XXX
    return "v_color0";
}

function getColorIn(op, konst, info) {
    function makeVector(factor) {
        return glslCall("vec3", [factor, factor, factor]);
    }

    var suffixes = [".rgb", ".aaa"];
    var suffix = suffixes[op & 1];

    switch (op) {
        case 0x00:
        case 0x01:
        case 0x02:
        case 0x03:
        case 0x04:
        case 0x05:
        case 0x06:
        case 0x07:
            return getRegIdName(op >> 1) + suffix;
        case 0x08:
        case 0x09:
            return getTexAccess(info) + suffix;
        case 0x0A:
        case 0x0B:
            return getRasColor(info) + suffix;
        case 0x0C:
            return makeVector("1.0");
        case 0x0D:
            return makeVector("0.5");
        case 0x0E:
            switch (konst) {
                case 0x00: return makeVector("1.0");
                case 0x01: return makeVector("0.875");
                case 0x02: return makeVector("0.75");
                case 0x03: return makeVector("0.625");
                case 0x04: return makeVector("0.5");
                case 0x05: return makeVector("0.375");
                case 0x06: return makeVector("0.25");
                case 0x07: return makeVector("0.125");
                case 0x08:
                case 0x09:
                case 0x0A:
                case 0x0B:
                    console.warn("unknown color factor");
                    return "";
                default:
                    konst -= 0x0C;
                    suffixes = [".rgb", ".rrr", ".ggg", ".bbb", ".aaa"];
                    suffix = suffixes[(konst / 4) | 0];
                    return getKonstIdName(konst % 4) + suffix;
            }
        case 0x0F:
            return makeVector("0.0");
        default:
            console.warn("unknown color op", op);
            return "";
    }
}

function getAlphaIn(op, konst, info) {
    switch (op) {
        case 0x00:
        case 0x01:
        case 0x02:
        case 0x03:
            return getRegIdName(op) + ".a";
        case 0x04:
            return getTexAccess(info) + ".a";
        case 0x05:
            return getRasColor(info) + ".a";
        case 0x06:
            switch (konst) {
                case 0x00: return "1.0";
                case 0x01: return "0.875";
                case 0x02: return "0.75";
                case 0x03: return "0.625";
                case 0x04: return "0.5";
                case 0x05: return "0.375";
                case 0x06: return "0.25";
                case 0x07: return "0.125";
                case 0x08:
                case 0x09:
                case 0x0A:
                case 0x0B:
                case 0x0C:
                case 0x0D:
                case 0x0E:
                case 0x0F:
                    console.warn("unknown alpha factor");
                default:
                    konst -= 0x10;
                    var suffixes = [".r", ".g", ".b", ".a"];
                    var suffix = suffixes[(konst / 4) | 0];
                    return getKonstIdName(konst % 4) + suffix;
            }
        case 0x07:
            return "0.0";
        default:
            console.warn("unknown alpha op");
            return "";
    }
}

function getMods(dest, bias, scale, clamp, type) {
    function makeOperand(factor) {
        if (type == 0)
            return glslCall("vec3", [factor, factor, factor]);
        else
            return glslValue(factor);
    }
    var lines = [];

    var biases = [ "+", "-" ];
    if (bias == 1 || bias == 2)
        lines.push(dest + " += " + biases[bias - 1] + " " + makeOperand(0.5) + ";");

    var scales = [ 2, 4, .5 ];
    if (scale > 0)
        lines.push(dest + " *= " + glslValue(scales[scale - 1]) + ";");

    if (clamp)
        lines.push(dest + " = " + glslCall("clamp", [dest, makeOperand("0.0"), makeOperand("1.0")]) + ";");

    return lines;
}

function getOp(op, bias, scale, clamp, regId, ins, type) {
    var suffix = [".rgb", ".a"];
    var dest = getRegIdName(regId) + suffix[type];
    var lines = [];

    switch (op) {
        case 0x00:
        case 0x01:
            var opStr = (op == 0) ? "" : "-";
            lines.push(dest + " = " + opStr + glslCall("mix", ins.slice(0, 3)) + " + " + ins[3] + ";");
            lines.push.apply(lines,getMods(dest, bias, scale, clamp, type));
            break;
        default:
            console.warn("unsupported op");
            break;
    }

    return lines;
}

function getAlphaCompareComponent(comp, ref) {
    var refStr = glslValue(ref / 255);
    var varName = getRegIdName(0) + ".a";
    switch (comp) {
        case 0: // GX_NEVER
            return "false";
        case 1: // GX_LESS
            return varName + " < " + refStr;
        case 2: // GX_EQUAL
            return varName + " == " + refStr;
        case 3: // GX_LEQUAL
            return varName + " <= " + refStr;
        case 4: // GX_GREATER
            return varName + " > " + refStr;
        case 5: // GX_NEQUAL
            return varName + " != " + refStr;
        case 6: // GX_GEQUAL
            return varName + " >= " + refStr;
        case 7: // GX_ALWAYS
            return "true";
        default:
            console.warn("bad compare component");
    }
}

function getAlphaCompareOp(op) {
    switch (op) {
        case 0: // GX_AOP_AND
            return "a && b";
        case 1: // GX_AOP_OR
            return "a || b";
        case 2: // GX_AOP_XOR
            return "a != b";
        case 3: // GX_AOP_XNOR
            return "a == b";
        default:
            console.warn("bad compare op")
    }
}

function getAlphaCompare(ac) {
    var lines = [];
    lines.push("bool a = " + getAlphaCompareComponent(ac.comp0, ac.ref0) + ";");
    lines.push("bool b = " + getAlphaCompareComponent(ac.comp1, ac.ref1) + ";");
    lines.push("");
    lines.push("if (!(" + getAlphaCompareOp(ac.alphaOp) + "))");
    lines.push("    discard;");
    return lines;
}

function generateShader(decls, main) {
    var indentedMain = main.map(function(x) {
        return "    " + x;
    });

    return (decls.join("\n") + "\n\n" +
        "void main() {\n" +
        indentedMain.join("\n") + "\n" +
        "}\n");
}

function generateVertShader() {
    var uniforms = [];
    var varyings = [];
    var attributes = [];
    var main = [];

    // We should always have position.
    uniforms.push("uniform mat4 u_modelView;");
    uniforms.push("uniform mat4 u_projection;");
    uniforms.push("uniform mat4 u_vertexMatrix;");

    attributes.push("attribute vec3 a_position;");
    main.push("gl_Position = u_projection * u_modelView * u_vertexMatrix * vec4(a_position, 1.0);");

    for (var i = 0; i < 2; i++) {
        var name = "color" + i;

        varyings.push("varying vec4 v_" + name + ";");
        attributes.push("attribute vec4 a_" + name + ";");
        main.push("v_" + name + " = a_" + name + ";");
    }

    var decls = [];
    decls.push.apply(decls, uniforms);
    decls.push("");
    decls.push.apply(decls, varyings);
    decls.push("");
    decls.push.apply(decls, attributes);
    return generateShader(decls, main);
}

function generateFragShader(bmd, material) {
    var mat3 = bmd.mat3;
    var header = [];
    var varyings = [];
    var init = [];
    var main = [];

    header.push("precision mediump float;");

    varyings.push("varying vec4 v_color0;");
    varyings.push("varying vec4 v_color1;");

    function colorVec(color) {
        return glslCall("vec4", color);
    }

    // Check what we need.
    var needKonst = [false, false, false, false];
    var needReg = [false, false, false, false];

    for (var i = 0; i < mat3.tevCounts[material.tevCountIndex]; i++) {
        var konstColor = material.constColorSel[i];
        var konstAlpha = material.constAlphaSel[i];
        var stage = mat3.tevStageInfos[material.tevStageInfo[i]];
        var order = mat3.tevOrderInfos[material.tevOrderInfo[i]];

        needReg[stage.colorRegId] = true;
        needReg[stage.alphaRegId] = true;

        stage.colorIn.forEach(function(x) {
            if (x == 0x0E && konstColor >= 0x0C)
                needKonst[(konstColor - 0x0C) % 4] = true;
            if (x <= 0x07)
                needReg[(x / 2) | 0] = true;
        });

        stage.alphaIn.forEach(function(x) {
            if (x == 0x06 && konstAlpha >= 0x10)
                needKonst[(konstAlpha - 0x10) % 4] = true;
            if (x <= 0x03)
                needReg[x] = true;
        });

        var colorsIn = stage.colorIn.map(function(x) {
            return getColorIn(x, konstColor, order);
        });
        var alphasIn = stage.alphaIn.map(function(x) {
            return getAlphaIn(x, konstAlpha, order);
        });

        main.push("// Tev stage " + i);
        main.push.apply(main, getOp(stage.colorOp, stage.colorBias, stage.colorScale,
                                    stage.colorClamp, stage.colorRegId, colorsIn, 0));
        main.push.apply(main, getOp(stage.alphaOp, stage.alphaBias, stage.alphaScale,
                                    stage.alphaClamp, stage.alphaRegId, alphasIn, 1));
        main.push("");
    }

    main.push.apply(main, getAlphaCompare(mat3.alphaCompares[material.alphaCompIndex]));

    main.push("");

    var blendInfo = bmd.mat3.blendInfos[material.blendIndex];
    if (blendInfo.blendMode > 0) {
        main.push("gl_FragColor = " + getRegIdName(0) + ";");
    } else {
        main.push("gl_FragColor = vec4(" + getRegIdName(0) + ".rgb, 1.0);");
    }

    // Declare constants
    needKonst.forEach(function(x, i) {
        if (!x)
            return;

        var color = mat3.color3[material.color3[i]];
        init.push("const vec4 " + getKonstIdName(i) + " = " + colorVec(color) + ";");
    });

    // Declare registers
    needReg.forEach(function(x, i) {
        if (!x)
            return;

        var decl = "vec4 " + getRegIdName(i);
        if (i > 0) {
            var color = mat3.colorS10[material.colorS10[i - 1]];
            decl += " = " + colorVec(color);
        }
        init.push(decl + ";");
    });

    var decls = [];
    decls.push.apply(decls, header);
    decls.push("");
    decls.push.apply(decls, varyings);

    var src = [];
    src.push.apply(src, init);
    src.push("");
    src.push.apply(src, main);
    return generateShader(decls, src);
}

function compileShader(gl, str, type) {
    var shader = gl.createShader(type);

    gl.shaderSource(shader, str);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
        return null;
    }

    return shader;
}

var vertShader = null;

function generateMaterialProgram(gl, bmd, material) {
    if (!vertShader) {
        var vert = generateVertShader();
        vertShader = compileShader(gl, vert, gl.VERTEX_SHADER);
    }

    var frag = generateFragShader(bmd, material);
    var fragShader = compileShader(gl, frag, gl.FRAGMENT_SHADER);

    var prog = gl.createProgram();
    gl.attachShader(prog, vertShader);
    gl.attachShader(prog, fragShader);
    gl.linkProgram(prog);

    prog.locations = {};
    prog.uniformNames = ["modelView", "projection", "vertexMatrix"];
    prog.attribNames = ["position", "color0", "color1"];

    prog.uniformNames.forEach(function(name) {
        prog.locations[name] = gl.getUniformLocation(prog, "u_" + name);
    });
    prog.attribNames.forEach(function(name) {
        prog.locations[name] = gl.getAttribLocation(prog, "a_" + name);
    });

    return prog;
}

function translateBatch(gl, bmd, batch) {
    var command = { type: "draw" };

    function range(end) {
        var r = new Uint16Array(end);
        for (var i = 0; i < end; i++)
            r[i] = i;
        return r;
    }

    if (batch.matrixType != 0)
        console.warn("Unsupported matrix type in batch");

    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, batch.verts, gl.STATIC_DRAW);
    command.buffer = buffer;

    var elementBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elementBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, range(batch.vertCount), gl.STATIC_DRAW);
    command.elementBuffer = elementBuffer;

    command.itemSize = batch.itemSize;
    command.packets = batch.packets;
    command.attribs = batch.attribs;

    return command;
}

function translateMaterial(gl, bmd, material) {
    var command = { type: "updateMaterial" };
    command.program = generateMaterialProgram(gl, bmd, material);

    function translateCullMode(cullMode) {
        var cullInfo = {};
        switch (cullMode) {
            case 0: // GX_CULL_NONE
                cullInfo.enable = false;
                break;
            case 1: // GX_CULL_FRONT
                cullInfo.enable = true;
                cullInfo.face = gl.FRONT;
                break;
            case 2: // GX_CULL_BACK
                cullInfo.enable = true;l
                cullInfo.face = gl.BACk;
                break;
        }
        return cullInfo;
    }

    command.cullInfo = bmd.mat3.cullModes[material.cullIndex];

    function getBlendFunc(blendMode) {
        switch(blendMode) {
            case 0: // GX_BL_ZERO
                return gl.ZERO;
            case 1: // GX_BL_ONE
                return gl.ONE;
            case 2: // GX_BL_SRCCLR / GX_BL_DSTCLR
                return gl.SRC_COLOR;
            case 3: // GX_BL_INVSRCCLOR / GX_BL_INVDSTCLR
                return gl.ONE_MINUS_SRC_COLOR;
            case 4: // GX_BL_SRCALPHA
                return gl.SRC_ALPHA;
            case 5: // GX_BL_INVSRCALPHA
                return gl.ONE_MINUS_SRC_ALPHA;
            case 6: // GX_DSTALPHA
                return gl.DST_ALPHA;
            case 7: // GX_INVDSTALPHA
                return gl.ONE_MINUS_DST_ALPHA;
            default:
                console.warn("Unknown blend mode ", blendMode);
                return gl.ONE;
        }
    }

    function translateBlendInfo(blendInfo) {
        var info = {};
        info.enable = blendInfo.blendMode > 0;
        info.src = getBlendFunc(blendInfo.srcFactor);
        info.dst = getBlendFunc(blendInfo.dstFactor);
        return info;
    }

    command.blendInfo = translateBlendInfo(bmd.mat3.blendInfos[material.blendIndex]);

    function getDepthFunc(func) {
        switch (func) {
            case 0: // GX_NEVER
                return gl.NEVER;
            case 1: // GX_LESS
                return gl.LESS;
            case 2: // GX_EQUAL
                return gl.EQUAL;
            case 3: // GX_LEQUAL
                return gl.LEQUAL;
            case 4: // GX_GREATER
                return gl.GREATER;
            case 5: // GX_NEQUAL
                return gl.NOTEQUAL;
            case 6: // GX_GEQUAL
                return gl.GEQUAL;
            case 7: // GX_ALWAYS
                return gl.ALWAYS;
            default:
                console.warn("Unknown depth func", func);
                return gl.ALWAYS;
        }
    }

    function translateZMode(zMode) {
        var depthTest = {};
        depthTest.enable = zMode.enable;
        depthTest.func = getDepthFunc(zMode.zFunc);
        depthTest.mask = zMode.enableUpdate;
        return depthTest;
    }

    var zMode = bmd.mat3.zModes[material.zModeIndex];
    command.depthTest = translateZMode(zMode);

    return command;
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

function decompressDXT1(texture, dst) {
    var runner = 0;
    var h = texture.height, w = texture.width, p = texture.pixels;

    function word(a) {
        return p[a] | (p[a+1] << 8);
    }

    function dword(a) {
        return p[a] | (p[a+1] << 8) | (p[a+2] << 16) | (p[a+3] << 24);
    }

    var colorTable = new Uint8Array(16);
    for(var y = 0; y < h; y += 4) {
        for(var x = 0; x < w; x += 4) {
            var color1 = word(runner);
            var color2 = word(runner + 2);
            var bits = dword(runner + 4);
            runner += 8;

            r5g6b5(colorTable, 0, color1);
            r5g6b5(colorTable, 4, color2);

            if (color1 > color2) {
                colorTable[8+0] = (2*colorTable[0+0] + colorTable[4+0] + 1) / 3;
                colorTable[8+1] = (2*colorTable[0+1] + colorTable[4+1] + 1) / 3;
                colorTable[8+2] = (2*colorTable[0+2] + colorTable[4+2] + 1) / 3;
                colorTable[8+3] = 0xFF;

                colorTable[12+0] = (colorTable[0+0] + 2*colorTable[4+0] + 1) / 3;
                colorTable[12+1] = (colorTable[0+1] + 2*colorTable[4+1] + 1) / 3;
                colorTable[12+2] = (colorTable[0+2] + 2*colorTable[4+2] + 1) / 3;
                colorTable[12+3] = 0xFF;
            } else {
                colorTable[8+0] = (colorTable[0+0] + colorTable[4+0] + 1) / 2;
                colorTable[8+1] = (colorTable[0+1] + colorTable[4+1] + 1) / 2;
                colorTable[8+2] = (colorTable[0+2] + colorTable[4+2] + 1) / 2;
                colorTable[8+3] = 0xFF;

                //only the alpha value of this color is important...
                colorTable[12+0] = (colorTable[0+0] + 2*colorTable[4+0] + 1) / 3;
                colorTable[12+1] = (colorTable[0+1] + 2*colorTable[4+1] + 1) / 3;
                colorTable[12+2] = (colorTable[0+2] + 2*colorTable[4+2] + 1) / 3;
                colorTable[12+3] = 0x00;
            }

            for (var iy = 0; iy < 4; ++iy)
                for (var ix = 0; ix < 4; ++ix) {
                    var di = 4*((y + iy)*w + x + ix);
                    var si = bits & 0x03;
                    dst[di+0] = colorTable[si*4+0];
                    dst[di+1] = colorTable[si*4+1];
                    dst[di+2] = colorTable[si*4+2];
                    dst[di+3] = colorTable[si*4+3];
                    bits >>= 2;
              }
        }
    }
}

function textureToCanvas(texture) {
    var canvas = document.createElement("canvas");
    canvas.width = texture.width;
    canvas.height = texture.height;

    var ctx = canvas.getContext("2d");
    var imgData = ctx.createImageData(canvas.width, canvas.height);

    if (texture.format == "i8") {
        for (var si = 0, di = 0; di < imgData.data.length; si++, di += 4) {
            imgData.data[di+0] = texture.pixels[si];
            imgData.data[di+1] = texture.pixels[si];
            imgData.data[di+2] = texture.pixels[si];
            imgData.data[di+3] = 255;
        }
    } else if (texture.format == "rgba8") {
        for (var i = 0; i < imgData.data.length; i++)
            imgData.data[i] = texture.pixels[i];
    } else if (texture.format == "dxt1") {
        decompressDXT1(texture, imgData.data);
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas;
}

// Set by checkExtensions
var COMPRESSED_RGB_S3TC_DXT1_EXT = null;

function translateTexture(gl, bmd, texture) {
    var canvas = textureToCanvas(texture);
    document.body.appendChild(canvas);
}

function modelFromBmd(gl, stream, bmd) {
    var model = {};
    model.commands = [];

    model.textures = bmd.tex1.textures.map(function(tex) {
        return translateTexture(gl, bmd, tex);
    });

    bmd.inf1.entries.forEach(function(entry) {
        switch (entry.type) {
            case 0x01: // open child, not needed
            case 0x02: // close child, not needed
                break;
            case 0x10: // joint
                var matrix = bmd.jnt1.frames[entry.index];
                model.commands.push({ type: "updateMatrix", idx: entry.index, matrix: matrix });
                break;
            case 0x11: // material
                var index = bmd.mat3.indexToMatIndex[entry.index];
                var material = bmd.mat3.materials[index];
                model.commands.push(translateMaterial(gl, bmd, material));
                break;
            case 0x12: // batch
                var batch = bmd.shp1.batches[entry.index];
                model.commands.push(translateBatch(gl, bmd, batch));
                break;
        }
    });

    return model;
}

function checkExtensions(gl) {
    var extensions = gl.getSupportedExtensions();
    var s3tcExts = extensions.filter(function(name) {
        return /compressed_texture_s3tc$/.test(name);
    });
    if (!s3tcExts[0])
        return;

    var extension = gl.getExtension(s3tcExts[0]);
    var dxt1 = extension.COMPRESSED_RGB_S3TC_DXT1_EXT;
    if (!dxt1)
        return;

    COMPRESSED_RGB_S3TC_DXT1_EXT = dxt1;
}

window.addEventListener('load', function() {
    var canvas = document.querySelector("canvas");
    var gl = canvas.getContext("experimental-webgl");
    gl.viewportWidth = canvas.width;
    gl.viewportHeight = canvas.height;

    checkExtensions(gl);

    var scene = createScene(gl);
    var camera = mat4.create();
    mat4.translate(camera, camera, [0, 0, -4000]);
    scene.setCamera(camera);

    loadModel("faceship.bmd", function(stream, bmd) {
        var model = modelFromBmd(gl, stream, bmd);
        scene.attachModel(model);
    });

    var keysDown = {};
    var SHIFT = 16;

    function isKeyDown(key) {
        return !!keysDown[key.charCodeAt(0)];
    }

    window.addEventListener('keydown', function(e) {
        keysDown[e.keyCode] = true;
    });
    window.addEventListener('keyup', function(e) {
        delete keysDown[e.keyCode];
    });

    function update() {
        var cameraVel = vec3.create();
        var amount = 5;
        if (keysDown[SHIFT])
            amount *= 10;

        if (isKeyDown('W'))
            cameraVel[2] = amount;
        if (isKeyDown('S'))
            cameraVel[2] = -amount;
        if (isKeyDown('A'))
            cameraVel[0] = amount;
        if (isKeyDown('D'))
            cameraVel[0] = -amount;

        mat4.translate(camera, camera, cameraVel);
        scene.setCamera(camera);

        window.requestAnimationFrame(update);
    }

    update();

});
