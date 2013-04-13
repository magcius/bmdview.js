
function createScene(gl) {
    var projection = mat4.create();
    mat4.perspective(projection, 2*22.5, gl.viewportWidth / gl.viewportHeight, 0.1*128, 2500*128);
 
    var modelView = mat4.create();

    var drawTypes = { "strip": gl.TRIANGLE_STRIP,
                      "fan": gl.TRIANGLE_FAN };

    gl.viewport(0, 0, gl.viewportWidth, gl.viewportHeight);
    gl.clearColor(77/255, 50/255, 153/255, 1);
    gl.enable(gl.DEPTH_TEST);

    function renderModel(model) {
        var matrices = [];
        for (var i = 0; i < 10; i++)
            matrices.push(mat4.create());

        function command_updateMatrix(command) {
            matrices[command.idx] = command.matrix;
        }

        function command_draw(command) {
            var prog = command.program;
            gl.useProgram(prog);

            gl.bindBuffer(gl.ARRAY_BUFFER, command.buffer);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, command.elementBuffer);

            var attribs = command.attribs;
            attribs.forEach(function(attrib) {
                var name = attrib.name;
                gl.vertexAttribPointer(
                    prog.locations[name],          // location
                    attrib.size,                   // size
                    gl.FLOAT,                      // type
                    false,                         // normalize
                    command.itemSize          * 4, // stride
                    attrib.offset             * 4  // offset
                );
                gl.enableVertexAttribArray(prog.locations[name]);
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

            gl.uniformMatrix4fv(prog.locations.projection, false, projection);
            gl.uniformMatrix4fv(prog.locations.modelView, false, modelView);

            command.packets.forEach(function(packet) {
                if (updateMatrixTable(packet))
                    gl.uniformMatrix4fv(prog.locations.vertexMatrix, false, matrixTable[0]);

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
                gl.disableVertexAttribArray(prog.locations[attrib.name]);
            });
        }

        var dispatch = {
            "draw": command_draw,
            "updateMatrix": command_updateMatrix,
        };

        model.commands.forEach(function(command) {
            dispatch[command.type](command);
        });
    }

    var models = [];

    var scene = {};

    function render() {
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

var vertShader = null;
var fragShaders = {};

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
    main.push("gl_FragColor = " + getRegIdName(0) + ";");

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

function generateMaterialProgram(gl, bmd, material) {
    if (!vertShader) {
        var vert = generateVertShader();
        vertShader = compileShader(gl, vert, gl.VERTEX_SHADER);
    }

    var fragKey = material.index;
    if (!fragShaders[fragKey]) {
        var frag = generateFragShader(bmd, material);
        fragShaders[fragKey] = compileShader(gl, frag, gl.FRAGMENT_SHADER);
    }

    var prog = gl.createProgram();
    gl.attachShader(prog, vertShader);
    gl.attachShader(prog, fragShaders[fragKey]);
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

function translateBatch(gl, bmd, batch, material) {
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

    command.program = generateMaterialProgram(gl, bmd, material);
    command.itemSize = batch.itemSize;
    command.packets = batch.packets;
    command.attribs = batch.attribs.filter(function(attrib) {
        if (command.program.locations[attrib.name] === undefined)
            return false; // TODO: this attribute
        return true;
    });

    return command;
}

function modelFromBmd(gl, bmd) {
    var model = {};
    model.commands = [];

    var material;

    bmd.inf1.entries.forEach(function(entry) {
        switch (entry.type) {
            case 0x01: // open child, not needed
            case 0x02: // close child, not needed
                break;
            case 0x10: // joint
                var matrix = bmd.jnt1.frames[entry.index];
                model.commands.push({ type: "updateMatrix", idx: entry.index, matrix: matrix });
                break;
            case 0x11: // material, TODO
                var index = bmd.mat3.indexToMatIndex[entry.index];
                material = bmd.mat3.materials[index];
                break;
            case 0x12: // batch
                var batch = bmd.shp1.batches[entry.index];
                model.commands.push(translateBatch(gl, bmd, batch, material));
                break;
        }
    });

    return model;
}

window.addEventListener('load', function() {
    var canvas = document.querySelector("canvas");
    var gl = canvas.getContext("experimental-webgl");
    gl.viewportWidth = canvas.width;
    gl.viewportHeight = canvas.height;

    var scene = createScene(gl);
    var camera = mat4.create();
    mat4.translate(camera, camera, [0, 0, -4000]);
    scene.setCamera(camera);

    loadModel("faceship.bmd", function(bmd) {
        var model = modelFromBmd(gl, bmd);
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

    var fps = 60;
    var interval = 1000 / fps;

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
        setTimeout(update, interval);
    }

    update();

});
