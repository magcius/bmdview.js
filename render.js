(function() {
    "use strict";

    function createScene(gl) {
        var projection = mat4.create();
        mat4.perspective(projection, Math.PI / 4, gl.viewportWidth / gl.viewportHeight, 0.1*128, 2500*128);

        var view = mat4.create();

        gl.viewport(0, 0, gl.viewportWidth, gl.viewportHeight);
        gl.clearColor(200/255, 50/255, 153/255, 1);

        gl.enable(gl.DEPTH_TEST);
        gl.enable(gl.CULL_FACE);
        gl.frontFace(gl.CW);

        function getPrimitiveType(drawType) {
            switch (drawType) {
                case gx.PrimitiveType.TRIANGLESTRIP:
                    return gl.TRIANGLE_STRIP;
                case gx.PrimitiveType.TRIANGLEFAN:
                    return gl.TRIANGLE_FAN;
            }
        }

        function renderModel(model) {
            if (!model.visible)
                return;

            var attribLocations;
            var uniformLocations;

            var matrixTable = new Float32Array(16 * 8);

            function bindMatrixTable(packetMatrixTable) {
                packetMatrixTable.forEach(function(matrixIdx, i) {
                    var frame = model.joints[matrixIdx];
                    matrixTable.set(frame, i * 16);
                });

                gl.uniformMatrix4fv(uniformLocations["matrixTable"], false, matrixTable);
            }

            function command_updateMaterial(command) {
                gl.useProgram(command.program);
                attribLocations = command.program.attribLocations;
                uniformLocations = command.program.uniformLocations;

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

                function applyTexture(texIndex, i) {
                    if (texIndex == -1)
                        return;

                    var texture = model.textures[texIndex];
                    if (texture == null)
                        return;

                    gl.activeTexture(gl.TEXTURE0 + i);
                    gl.bindTexture(gl.TEXTURE_2D, texture.textureId);

                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, texture.wrapS);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, texture.wrapT);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, texture.minFilter);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, texture.magFilter);
                }

                applyBlendInfo(command.blendInfo);
                applyCullInfo(command.cullInfo);
                applyDepthTest(command.depthTest);
                command.textureIndexes.forEach(applyTexture);
                gl.uniform1iv(command.program.uniformLocations["texture"], [0, 1, 2, 3, 4, 5, 6, 7]);

                gl.uniformMatrix4fv(uniformLocations["projection"], false, projection);
                gl.uniformMatrix4fv(uniformLocations["view"], false, view);
            }

            function command_draw(command) {
                gl.bindBuffer(gl.ARRAY_BUFFER, command.buffer);
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, command.elementBuffer);

                var attribs = command.attribs;
                attribs.forEach(function(attrib) {
                    var type = attrib.type;
                    if (attribLocations[type] === undefined)
                        return; // TODO: this attribute
                    if (attribLocations[type] === -1)
                        return; // Unused in the shader.

                    gl.vertexAttribPointer(
                        attribLocations[type],         // location
                        attrib.size,                   // size
                        gl.FLOAT,                      // type
                        false,                         // normalize
                        command.itemSize          * 4, // stride
                        attrib.offset             * 4  // offset
                    );
                    gl.enableVertexAttribArray(attribLocations[type]);
                });

                command.packets.forEach(function(packet) {
                    bindMatrixTable(packet.matrixTable);

                    packet.primitives.forEach(function(prim) {
                        gl.drawElements(
                            getPrimitiveType(prim.drawType), // mode
                            prim.count,                      // count
                            gl.UNSIGNED_SHORT,               // type
                            prim.start * 2                   // offset
                        );
                    });
                });

                attribs.forEach(function(attrib) {
                    var type = attrib.type;
                    if (attribLocations[type] === undefined)
                        return; // TODO: this attribute
                    if (attribLocations[type] === -1)
                        return; // Unused in the shader.

                    gl.disableVertexAttribArray(attribLocations[type]);
                });
            }

            var dispatch = {
                "draw": command_draw,
                "updateMaterial": command_updateMaterial,
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
            mat4.invert(view, matrix);
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
        return "texture2D(texture[" + info.texMap + "], v_texCoord"  + info.texCoordId + ".st)";
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
            case gx.CombineColorInput.CPREV:
            case gx.CombineColorInput.APREV:
            case gx.CombineColorInput.C0:
            case gx.CombineColorInput.A0:
            case gx.CombineColorInput.C1:
            case gx.CombineColorInput.A1:
            case gx.CombineColorInput.C2:
            case gx.CombineColorInput.A2:
                return getRegIdName(op >> 1) + suffix;
            case gx.CombineColorInput.TEXC:
            case gx.CombineColorInput.TEXA:
                return getTexAccess(info) + suffix;
            case gx.CombineColorInput.RASC:
            case gx.CombineColorInput.RASA:
                return getRasColor(info) + suffix;
            case gx.CombineColorInput.ONE:
                return makeVector("1.0");
            case gx.CombineColorInput.HALF:
                return makeVector("0.5");
            case gx.CombineColorInput.KONST:
                switch (konst) {
                    case gx.KonstColorSel.KCSEL_1: return makeVector("1.0");
                    case gx.KonstColorSel.KCSEL_7_8: return makeVector("0.875");
                    case gx.KonstColorSel.KCSEL_3_4: return makeVector("0.75");
                    case gx.KonstColorSel.KCSEL_5_8: return makeVector("0.625");
                    case gx.KonstColorSel.KCSEL_1_2: return makeVector("0.5");
                    case gx.KonstColorSel.KCSEL_3_8: return makeVector("0.375");
                    case gx.KonstColorSel.KCSEL_1_4: return makeVector("0.25");
                    case gx.KonstColorSel.KCSEL_1_8: return makeVector("0.125");
                    default:
                        konst -= 0x0C;
                        suffixes = [".rgb", ".rrr", ".ggg", ".bbb", ".aaa"];
                        suffix = suffixes[(konst / 4) | 0];
                        return getKonstIdName(konst % 4) + suffix;
                }
            case gx.CombineColorInput.ZERO:
                return makeVector("0.0");
            default:
                console.warn("unknown color op", op);
                return "";
        }
    }

    function getAlphaIn(op, konst, info) {
        switch (op) {
            case gx.CombineAlphaInput.APREV:
            case gx.CombineAlphaInput.A0:
            case gx.CombineAlphaInput.A1:
            case gx.CombineAlphaInput.A2:
                return getRegIdName(op) + ".a";
            case gx.CombineAlphaInput.TEXA:
                return getTexAccess(info) + ".a";
            case gx.CombineAlphaInput.RASA:
                return getRasColor(info) + ".a";
            case gx.CombineAlphaInput.KONST:
                switch (konst) {
                    case gx.KonstAlphaSel.KASEL_1: return "1.0";
                    case gx.KonstAlphaSel.KASEL_7_8: return "0.875";
                    case gx.KonstAlphaSel.KASEL_3_4: return "0.75";
                    case gx.KonstAlphaSel.KASEL_5_8: return "0.625";
                    case gx.KonstAlphaSel.KASEL_1_2: return "0.5";
                    case gx.KonstAlphaSel.KASEL_3_8: return "0.375";
                    case gx.KonstAlphaSel.KASEL_1_4: return "0.25";
                    case gx.KonstAlphaSel.KASEL_1_8: return "0.125";
                    default:
                        konst -= 0x10;
                        var suffixes = [".r", ".g", ".b", ".a"];
                        var suffix = suffixes[(konst / 4) | 0];
                        return getKonstIdName(konst % 4) + suffix;
                }
            case gx.CombineAlphaInput.ZERO:
                return "0.0";
            default:
                console.warn("unknown alpha op");
                return "";
        }
    }

    function getMods(value, bias, scale, clamp, type) {
        function makeOperand(factor) {
            if (type == 0)
                return glslCall("vec3", [factor, factor, factor]);
            else
                return glslValue(factor);
        }

        if (bias == gx.TevBias.ADDHALF)
            value = value + " + " + makeOperand(0.5);
        else if (bias == gx.TevBias.SUBHALF)
            value = value + " - " + makeOperand(0.5);

        if (scale == gx.TevScale.SCALE_2)
            value = "(" + value + ") * " + glslValue(2);
        else if (scale == gx.TevScale.SCALE_4)
            value = "(" + value + ") * " + glslValue(4);
        else if (scale == gx.TevScale.DIVIDE_2)
            value = "(" + value + ") * " + glslValue(0.5);

        if (clamp)
            value = glslCall("clamp", [value, makeOperand("0.0"), makeOperand("1.0")]);

        return value;
    }

    function getOp(op, bias, scale, clamp, regId, ins, type) {
        var suffix = [".rgb", ".a"];
        var dest = getRegIdName(regId) + suffix[type];
        var a = ins[0], b = ins[1], c = ins[2], d = ins[3];
        var value;

        switch (op) {
            case gx.TevOp.ADD:
            case gx.TevOp.SUB:
                var opStr = (op == gx.TevOp.ADD) ? " + " : " - ";
                value = glslValue(d) + opStr + glslCall("mix", [a, b, c]);
                value = getMods(value, bias, scale, clamp, type);
                break;
            default:
                console.warn("unsupported op");
                break;
        }

        var line = dest + " = " + value + ";";
        return line;
    }

    function getAlphaCompareComponent(comp, ref) {
        var refStr = glslValue(ref / 255);
        var varName = getRegIdName(0) + ".a";
        switch (comp) {
            case gx.CompareType.NEVER:
                return "false";
            case gx.CompareType.LESS:
                return varName + " < " + refStr;
            case gx.CompareType.EQUAL:
                return varName + " == " + refStr;
            case gx.CompareType.LEQUAL:
                return varName + " <= " + refStr;
            case gx.CompareType.GREATER:
                return varName + " > " + refStr;
            case gx.CompareType.NEQUAL:
                return varName + " != " + refStr;
            case gx.CompareType.GEQUAL:
                return varName + " >= " + refStr;
            case gx.CompareType.ALWAYS:
                return "true";
            default:
                console.warn("bad compare component");
        }
    }

    function getAlphaCompareOp(op) {
        switch (op) {
            case gx.AlphaOp.AND:
                return "a && b";
            case gx.AlphaOp.OR:
                return "a || b";
            case gx.AlphaOp.XOR:
                return "a != b";
            case gx.AlphaOp.XNOR:
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

    // Vertex attrib types we care about
    var vertexAttribs = [
        { storage: "float", type: gx.VertexAttribute.PTNMTXIDX, name: "matrixIndex" },
        { storage: "vec3", type: gx.VertexAttribute.NRM,  name: "normal" },
        { storage: "vec3", type: gx.VertexAttribute.POS,  name: "position" },
        { storage: "vec4", type: gx.VertexAttribute.CLR0, name: "color0" },
        { storage: "vec4", type: gx.VertexAttribute.CLR1, name: "color1" },
        { storage: "vec2", type: gx.VertexAttribute.TEX0, name: "texCoord0" },
        { storage: "vec2", type: gx.VertexAttribute.TEX1, name: "texCoord1" },
        { storage: "vec2", type: gx.VertexAttribute.TEX2, name: "texCoord2" },
        { storage: "vec2", type: gx.VertexAttribute.TEX3, name: "texCoord3" },
        { storage: "vec2", type: gx.VertexAttribute.TEX4, name: "texCoord4" },
        { storage: "vec2", type: gx.VertexAttribute.TEX5, name: "texCoord5" },
        { storage: "vec2", type: gx.VertexAttribute.TEX6, name: "texCoord6" },
        { storage: "vec2", type: gx.VertexAttribute.TEX7, name: "texCoord7" },
    ];

    function getTexGenSrc(texGenSrc) {
        switch (texGenSrc) {
            case gx.TexGenSrc.POS:
                return "vec4(v_position, 0.0);";
            case gx.TexGenSrc.NRM:
                return "vec4(v_normal, 0.0)";
            case gx.TexGenSrc.TEX0:
            case gx.TexGenSrc.TEX1:
            case gx.TexGenSrc.TEX2:
            case gx.TexGenSrc.TEX3:
            case gx.TexGenSrc.TEX4:
            case gx.TexGenSrc.TEX5:
            case gx.TexGenSrc.TEX6:
            case gx.TexGenSrc.TEX7:
                return "vec4(a_texCoord" + (texGenSrc - gx.TexGenSrc.TEX0) + ", 0.0, 0.0)";
            case gx.TexGenSrc.BINRM:
            case gx.TexGenSrc.TANGENT:
                console.warn("Unsupported TexGenSrc", texGenSrc);
                return "vec4(v_position, 0.0);";
        }
    }

    function colorVec(color) {
        return glslCall("vec4", color);
    }

    function generateVertShader(bmd, material) {
        var mat3 = bmd.mat3;
        var uniforms = [];
        var varyings = [];
        var attributes = [];
        var main = [];

        // We should always have position.
        uniforms.push("uniform mat4 u_projection;");
        uniforms.push("uniform mat4 u_view;");
        uniforms.push("uniform mat4 u_matrixTable[8];");

        main.push("gl_Position = u_projection * u_view * u_matrixTable[int(a_matrixIndex)] * vec4(a_position, 1.0);");

        function makeAttribute(attrib) {
            varyings.push("varying " + attrib.storage + " v_" + attrib.name + ";");
            attributes.push("attribute " + attrib.storage + " a_" + attrib.name + ";");
        }
        vertexAttribs.forEach(makeAttribute);

        main.push("v_matrixIndex = a_matrixIndex;");
        main.push("v_position = a_position;");
        main.push("v_normal = a_normal;");

        for (var i = 0; i < 2; i++) {
            var colorChanInfo = mat3.colorChanInfos[material.chanControls[i]];
            var value = '';
            if (colorChanInfo.matColorSource == gx.ColorSrc.REG)
                value = colorVec(mat3.color1[material.color1[i]]);
            else if (colorChanInfo.matColorSource == gx.ColorSrc.VTX)
                value = "a_color" + i;

            main.push("v_color" + i + " = " + value + ";");

            // XXX: We need proper lighting at some point.
            if (colorChanInfo.enable)
                main.push("v_color.rgb *= 0.5;");
        }

        for (var i = 0; i < mat3.texGenCounts[material.texGenCountIndex]; i++) {
            var texGenInfo = mat3.texGenInfos[material.texGenInfo[i]];

            // XXX: use TexGenType at some point? How does that work?

            var matrix = texGenInfo.matrix;
            var value = "";
            value += getTexGenSrc(texGenInfo.texGenSrc);

            main.push("v_texCoord" + i + " = " + value + ".st;");
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
        var uniforms = [];
        var init = [];
        var main = [];

        header.push("precision mediump float;");

        function makeAttribute(attrib) {
            varyings.push("varying " + attrib.storage + " v_" + attrib.name + ";");
        }
        vertexAttribs.forEach(makeAttribute);

        uniforms.push("uniform sampler2D texture[8];");

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
                if (x == gx.CombineColorInput.KONST && konstColor >= 0x0C)
                    needKonst[(konstColor - 0x0C) % 4] = true;
                if (x <= gx.CombineColorInput.A2)
                    needReg[(x / 2) | 0] = true;
            });

            stage.alphaIn.forEach(function(x) {
                if (x == gx.CombineAlphaInput.KONST && konstAlpha >= 0x10)
                    needKonst[(konstAlpha - 0x10) % 4] = true;
                if (x <= gx.CombineAlphaInput.A2)
                    needReg[x] = true;
            });

            var colorsIn = stage.colorIn.map(function(x) {
                return getColorIn(x, konstColor, order);
            });
            var alphasIn = stage.alphaIn.map(function(x) {
                return getAlphaIn(x, konstAlpha, order);
            });

            main.push("// Tev stage " + i);
            main.push(getOp(stage.colorOp, stage.colorBias, stage.colorScale,
                            stage.colorClamp, stage.colorRegId, colorsIn, 0));
            main.push(getOp(stage.alphaOp, stage.alphaBias, stage.alphaScale,
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
        decls.push.apply(decls, uniforms);
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

    function generateMaterialProgram(gl, bmd, material) {
        var vert = generateVertShader(bmd, material);
        var vertShader = compileShader(gl, vert, gl.VERTEX_SHADER);

        var frag = generateFragShader(bmd, material);
        var fragShader = compileShader(gl, frag, gl.FRAGMENT_SHADER);

        var prog = gl.createProgram();
        gl.attachShader(prog, vertShader);
        gl.attachShader(prog, fragShader);
        gl.linkProgram(prog);

        prog.uniformLocations = {};
        ["projection", "view", "matrixTable", "texture"].forEach(function(name) {
            prog.uniformLocations[name] = gl.getUniformLocation(prog, "u_" + name);
        });

        prog.attribLocations = [];
        vertexAttribs.forEach(function(attrib) {
            prog.attribLocations[attrib.type] = gl.getAttribLocation(prog, "a_" + attrib.name);
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
                case gx.CullMode.NONE:
                    cullInfo.enable = false;
                    break;
                case gx.CullMode.FRONT:
                    cullInfo.enable = true;
                    cullInfo.face = gl.FRONT;
                    break;
                case gx.CullMode.BACK:
                    cullInfo.enable = true;
                    cullInfo.face = gl.BACK;
                    break;
                case gx.CullMode.ALL:
                    cullInfo.enable = true;
                    cullInfo.face = gl.FRONT_AND_BACK;
                    break;
            }
            return cullInfo;
        }

        command.cullInfo = bmd.mat3.cullModes[material.cullIndex];

        function getBlendFunc(blendMode) {
            switch(blendMode) {
                case gx.BlendMode.ZERO:
                    return gl.ZERO;
                case gx.BlendMode.ONE:
                    return gl.ONE;
                case gx.BlendMode.SRCCLR:
                    return gl.SRC_COLOR;
                case gx.BlendMode.INVSRCCLOR:
                    return gl.ONE_MINUS_SRC_COLOR;
                case gx.BlendMode.SRCALPHA:
                    return gl.SRC_ALPHA;
                case gx.BlendMode.INVSRCALPHA:
                    return gl.ONE_MINUS_SRC_ALPHA;
                case gx.BlendMode.DSTALPHA:
                    return gl.DST_ALPHA;
                case gx.BlendMode.INVDSTALPHA:
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
                case gx.CompareType.NEVER:
                    return gl.NEVER;
                case gx.CompareType.LESS:
                    return gl.LESS;
                case gx.CompareType.EQUAL:
                    return gl.EQUAL;
                case gx.CompareType.LEQUAL:
                    return gl.LEQUAL;
                case gx.CompareType.GREATER:
                    return gl.GREATER;
                case gx.CompareType.NEQUAL:
                    return gl.NOTEQUAL;
                case gx.CompareType.GEQUAL:
                    return gl.GEQUAL;
                case gx.CompareType.ALWAYS:
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

        function translateTexStage(stage) {
            var texIndex = bmd.mat3.texStageIndexToTextureIndex[stage];
            if (texIndex == 0xFFFF)
                return -1;
            return texIndex;
        }

        command.textureIndexes = material.texStages.map(translateTexStage);

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

                    // Only the alpha value of this color is important...
                    colorTable[12+0] = 0x00;
                    colorTable[12+1] = 0x00;
                    colorTable[12+2] = 0x00;
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
        } else if (texture.format == "i8_a8") {
            for (var si = 0, di = 0; di < imgData.data.length; si += 2, di += 4) {
                imgData.data[di+0] = texture.pixels[si];
                imgData.data[di+1] = texture.pixels[si];
                imgData.data[di+2] = texture.pixels[si];
                imgData.data[di+3] = texture.pixels[si + 1];
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

    function textureToDOM(texture) {
        var d = document.createElement('div');
        var canvas = textureToCanvas(texture);
        d.appendChild(canvas);
        var p = document.createElement('span');
        p.textContent = texture.name;
        d.appendChild(p);
        return d;
    }

    var dumpTextures = true;

    // Set by checkExtensions
    var COMPRESSED_RGB_S3TC_DXT1_EXT = null;

    function translateTexture(gl, bmd, texture) {
        var out = {};

        if (dumpTextures) {
            var txc = document.querySelector('#textures');
            txc.appendChild(textureToDOM(texture));
        }

        var texId = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texId);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        function translateWrapMode(mode) {
            switch (mode) {
                case gx.WrapMode.CLAMP:
                    return gl.CLAMP_TO_EDGE;
                case gx.WrapMode.REPEAT:
                    return gl.REPEAT;
                case gx.WrapMode.MIRROR:
                    return gl.MIRRORED_REPEAT;
            }
        }

        out.wrapS = translateWrapMode(texture.wrapS);
        out.wrapT = translateWrapMode(texture.wrapT);

        function translateTexFilter(mode) {
            switch (mode) {
                case gx.TexFilter.NEAR:
                    return gl.NEAREST;
                case gx.TexFilter.LINEAR:
                case gx.TexFilter.NEAR_MIP_NEAR:
                case gx.TexFilter.LIN_MIP_NEAR:
                case gx.TexFilter.NEAR_MIP_LIN:
                case gx.TexFilter.LIN_MIP_LIN:
                    return gl.LINEAR;
            }
        }

        out.minFilter = translateTexFilter(texture.minFilter);
        out.magFilter = translateTexFilter(texture.magFilter);

        var compressed = false;
        var pixels = texture.pixels;
        var format;
        if (texture.format == "i8") {
            format = gl.LUMINANCE;
        } else if (texture.format == "i8_a8") {
            format = gl.LUMINANCE_ALPHA;
        } else if (texture.format == "rgba8") {
            format = gl.RGBA;
        } else if (texture.format == "dxt1" && COMPRESSED_RGB_S3TC_DXT1_EXT !== null) {
            compressed = true;
            format = COMPRESSED_RGB_S3TC_DXT1_EXT;
        } else if (texture.format == "dxt1") {
            pixels = new Uint8Array(texture.width * texture.height * 4);
            decompressDXT1(texture.pixels, pixels);
            format = gl.RGBA;
        } else {
            console.log("Unsupported texture format while loading");
        }

        if (compressed)
            gl.compressedTexImage2D(gl.TEXTURE_2D, 0, format, texture.width, texture.height, 0, pixels);
        else
            gl.texImage2D(gl.TEXTURE_2D, 0, format, texture.width, texture.height, 0, format, gl.UNSIGNED_BYTE, pixels);

        out.textureId = texId;

        return out;
    }

    function modelFromBmd(gl, stream, bmd) {
        var model = {};
        model.filename = bmd.filename;
        model.commands = [];

        model.textures = bmd.tex1.textures.map(function(tex) {
            return translateTexture(gl, bmd, tex);
        });

        var joints = [];
        var jointStack = [];
        bmd.inf1.entries.forEach(function(entry) {
            switch (entry.type) {
                case 0x01: // open child
                    jointStack.unshift(jointStack[0]);
                    break;
                case 0x02: // close child
                    jointStack.shift();
                    break;
                case 0x10: // joint
                    var matrix = mat4.clone(bmd.jnt1.frames[entry.index]);
                    if (jointStack.length > 1)
                        mat4.mul(matrix, joints[jointStack[1]], matrix);
                    joints[entry.index] = matrix;
                    jointStack[0] = entry.index;
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

        model.joints = joints;

        return model;
    }

    function checkExtensions(gl) {
        var extensions = gl.getSupportedExtensions();

        function checkS3TC() {
            var s3tcExts = extensions.filter(function(name) {
                return /compressed_texture_s3tc$/.test(name);
            });
            if (!s3tcExts[0]) {
                return;
            }

            var extension = gl.getExtension(s3tcExts[0]);
            var dxt1 = extension.COMPRESSED_RGB_S3TC_DXT1_EXT;
            if (!dxt1)
                return;

            COMPRESSED_RGB_S3TC_DXT1_EXT = dxt1;
        }

        checkS3TC();
    }

    var MODELS = [
        "exk/kindan/Room0.d/bdl/model.bdl",
        "exk/kindan/Room0.d/bdl/model3.bdl",
        "exk/kindan/Room1.d/bdl/model.bdl",
        "exk/kindan/Room2.d/bdl/model.bdl",
        "exk/kindan/Room3.d/bdl/model.bdl",
        "exk/kindan/Room4.d/bdl/model.bdl",
        "exk/kindan/Room5.d/bdl/model.bdl",
        "exk/kindan/Room5.d/bdl/model1.bdl",
        "exk/kindan/Room6.d/bdl/model.bdl",
        "exk/kindan/Room7.d/bdl/model.bdl",
        "exk/kindan/Room8.d/bdl/model.bdl",
        "exk/kindan/Room8.d/bdl/model1.bdl",
        "exk/kindan/Room9.d/bdl/model.bdl",
        "exk/kindan/Room9.d/bdl/model3.bdl",
        "exk/kindan/Room11.d/bdl/model.bdl",
        "exk/kindan/Room11.d/bdl/model1.bdl",
        "exk/kindan/Room12.d/bdl/model.bdl",
        "exk/kindan/Room12.d/bdl/model1.bdl",
        "exk/kindan/Room13.d/bdl/model.bdl",
        "! exk/kindan/Room14.d/bdl/model.bdl",
        "! exk/kindan/Room14.d/bdl/model1.bdl",
        "exk/kindan/Room15.d/bdl/model.bdl",
        "exk/kindan/Room16.d/bdl/model.bdl",
        "exk/kindan/Room16.d/bdl/model1.bdl",
        "exk/kindan/Room16.d/bdl/model3.bdl",
        "exk/outset.bdl",
        "exk/noki.bmd",
        "exk/faceship.bmd",
        "exk/plaza.bmd",
        "exk/sirena.bmd",
    ];

    window.addEventListener('load', function() {
        var canvas = document.querySelector("#scene");
        var gl = canvas.getContext("experimental-webgl", { alpha: false });
        gl.viewportWidth = canvas.width;
        gl.viewportHeight = canvas.height;

        checkExtensions(gl);

        var scene = createScene(gl);
        var camera = mat4.create();
        mat4.translate(camera, camera, [4854, 626, -4353]);
        mat4.rotateY(camera, camera, -1);
        scene.setCamera(camera);

        var h = location.hash.slice(1);
        if (h.endsWith('!')) {
            dumpTextures = false;
            h = h.slice(0, -1);
        }

        function modelDOM(filename, dv) {
            var li = document.createElement('li');
            var label = document.createElement('label');
            var option = document.createElement('input');
            option.type = 'checkbox';
            option.checked = dv;
            label.appendChild(option);
            label.appendChild(document.createTextNode(filename));
            li.appendChild(label);

            var model = null, visible = false;
            function toggle() {
                visible = !visible;
                if (visible && !model) {
                    loadModel(filename, function(stream, bmd) {
                        model = modelFromBmd(gl, stream, bmd);
                        model.visible = visible;
                        scene.attachModel(model);
                    });
                }
                if (model)
                    model.visible = visible;
            }
            if (dv)
                toggle();
            option.addEventListener('change', toggle);

            return li;
        }

        var mct = document.querySelector('#models');
        MODELS.forEach(function(m) {
            var dv = false;
            if (m.startsWith('! ')) {
                dv = true;
                m = m.slice(2);
            }
            mct.appendChild(modelDOM(m, dv));
        })

        var keysDown = {};
        var dragging = false, lx = 0, ly = 0;
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

        canvas.addEventListener('mousedown', function(e) {
            dragging = true;
            lx = e.pageX; ly = e.pageY;
        });
        canvas.addEventListener('mouseup', function(e) {
            dragging = false;
        });
        canvas.addEventListener('mousemove', function(e) {
            if (!dragging)
                return;

            var dx = e.pageX - lx;
            var dy = e.pageY - ly;
            var cu = [camera[1], camera[5], camera[9]];
            vec3.normalize(cu, cu);
            mat4.rotate(camera, camera, -dx / 500, cu);
            mat4.rotate(camera, camera, -dy / 500, [1, 0, 0]);
            lx = e.pageX; ly = e.pageY;
        });

        var tmp = mat4.create();
        var t = 0;
        function update(nt) {
            var dt = nt - t;
            t = nt;

            var mult = 20;
            if (keysDown[SHIFT])
                mult *= 10;
            mult *= (dt / 16.0);

            var amt;
            amt = 0;
            if (isKeyDown('W'))
                amt = -mult;
            else if (isKeyDown('S'))
                amt = mult;
            tmp[14] = amt;

            amt = 0;
            if (isKeyDown('A'))
                amt = -mult;
            else if (isKeyDown('D'))
                amt = mult;
            tmp[12] = amt;

            if (isKeyDown('B'))
                mat4.identity(camera);

            mat4.multiply(camera, camera, tmp);

            scene.setCamera(camera);
            window.requestAnimationFrame(update);
        }

        update(0);
    });

})();
