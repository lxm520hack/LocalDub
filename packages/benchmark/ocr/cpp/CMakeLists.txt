cmake_minimum_required(VERSION 3.10)
project(ocr_pipeline CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ORT path
set(ORT_DIR "/tmp/onnxruntime-linux-x64-1.24.4")
set(ORT_INCLUDE_DIR "${ORT_DIR}/include")
set(ORT_LIB_DIR "${ORT_DIR}/lib")

find_library(ONNXRUNTIME_LIB onnxruntime PATHS "${ORT_LIB_DIR}" NO_DEFAULT_PATH)

add_executable(ocr_pipeline ocr_pipeline.cpp)

target_include_directories(ocr_pipeline PRIVATE
    "${ORT_INCLUDE_DIR}"
    "${CMAKE_CURRENT_SOURCE_DIR}"
)

target_link_directories(ocr_pipeline PRIVATE "${ORT_LIB_DIR}")
target_link_libraries(ocr_pipeline PRIVATE ${ONNXRUNTIME_LIB} pthread)

# Copy ORT .so to build dir
add_custom_command(TARGET ocr_pipeline POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${ORT_LIB_DIR}/libonnxruntime.so.1.24.4"
        "$<TARGET_FILE_DIR:ocr_pipeline>/libonnxruntime.so.1"
    COMMENT "Copying ORT shared library"
)
